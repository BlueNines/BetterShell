const mysql = require('mysql2')
const { performance } = require('node:perf_hooks')

const MAX_CELL = 256 * 1024
const MAX_RESULT = 8 * 1024 * 1024
const MAX_SQL_ROWS = 1000
const NUMERIC_TYPES = new Set(['TINY', 'SHORT', 'LONG', 'INT24', 'LONGLONG', 'DECIMAL', 'NEWDECIMAL', 'FLOAT', 'DOUBLE', 'YEAR'])
const ACTIONS = new Set(['connect', 'disconnect', 'databases', 'tables', 'structure', 'browse', 'mutate', 'query', 'cancel'])

// 数据库和表名只能作为转义标识符使用，不能混入 SQL 条件。
function identifier (value) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('\0')) throw new Error('数据库标识符无效')
  return '`' + value.replace(/`/g, '``') + '`'
}

// 二进制使用 Base64，整数和 DECIMAL 保留原字符串，避免精度丢失。
function wireValue (value) {
  if (Buffer.isBuffer(value)) return value.length > MAX_CELL ? { kind: 'omitted', bytes: value.length } : { kind: 'binary', base64: value.toString('base64'), bytes: value.length }
  if (value === null || value === undefined) return null
  const result = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const bytes = Buffer.byteLength(result, 'utf8')
  return bytes > MAX_CELL ? { kind: 'omitted', bytes } : result
}

// 拒绝截断值和任意对象，提交时保留 NULL、二进制与文本的区别。
function bindValue (value) {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    if (Buffer.byteLength(String(value), 'utf8') > MAX_CELL) throw new Error('单个字段超过 256 KiB，请通过 SQL 或外部文件处理')
    return String(value)
  }
  if (value && value.kind === 'binary' && typeof value.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) {
    const buffer = Buffer.from(value.base64, 'base64')
    if (buffer.length > MAX_CELL || buffer.toString('base64') !== value.base64) throw new Error('二进制数据无效')
    return buffer
  }
  throw new Error('字段值无效，不能提交未完整加载的记录')
}

// 只保留界面需要的列信息，查询中的同名列也能独立显示。
function resultColumns (fields = []) {
  return fields.map(field => ({ name: field.name, type: mysql.Types[field.columnType] || String(field.columnType), table: field.orgTable || field.table || '', schema: field.schema || '' }))
}

// 精确数值比较显式转换参数，避免 BIGINT 和 DECIMAL 被当成浮点数比较。
function comparisonParameter (column) {
  if (/^(?:tinyint|smallint|mediumint|int|bigint|year)$/.test(column.dataType)) return `CAST(? AS ${/unsigned/i.test(column.type) ? 'UNSIGNED' : 'SIGNED'})`
  const decimal = column.type.match(/^decimal\((\d+),(\d+)\)/i)
  return decimal ? `CAST(? AS DECIMAL(${decimal[1]},${decimal[2]}))` : '?'
}

// 一条数据库连接对应一个面板，关闭面板时立即释放连接及 SSH 通道。
class MysqlSession {
  // 保存 SSH 会话获取函数，不复制或重新登录 SSH 凭据。
  constructor (getSsh, notify = () => {}) {
    this.getSsh = getSsh
    this.notify = notify
    this.connection = null
    this.config = null
    this.busy = false
    this.cancelled = false
    this.metadata = new Map()
    this.pendingFinish = null
    this.generation = 0
  }

  // 限制允许调用的方法，同一个连接只执行一个用户操作。
  async dispatch (action, body = {}) {
    if (!ACTIONS.has(action)) throw new Error('不支持的数据库操作')
    if (action === 'cancel' || action === 'disconnect') return this[action](body)
    if (this.busy) throw new Error('上一个数据库操作尚未结束')
    if (action !== 'connect' && !this.connection) throw new Error('数据库已断开，请重新连接')
    this.busy = true
    try { return await this[action](body) } finally { this.busy = false }
  }

  // 使用当前 SSH 的独立转发通道访问数据库，不占用交互终端。
  async streamFor (config) {
    if (config.mode !== 'ssh') return undefined
    const ssh = this.getSsh?.()
    if (!ssh || typeof ssh.forwardOut !== 'function') throw new Error('请先连接当前 SSH 服务器')
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => { settled = true; reject(new Error('SSH 数据库通道连接超时')) }, 10000)
      ssh.forwardOut('127.0.0.1', 0, config.host, config.port, (error, stream) => {
        clearTimeout(timer)
        if (settled) { stream?.destroy(); return }
        settled = true
        if (error) reject(new Error('无法通过 SSH 访问数据库：' + error.message))
        else resolve(stream)
      })
    })
  }

  // 创建 MySQL 原生协议连接，数值不经过 JavaScript 浮点转换。
  async createConnection (config) {
    const stream = await this.streamFor(config)
    const options = {
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database || undefined,
      stream,
      charset: 'UTF8MB4_UNICODE_CI',
      connectTimeout: 10000,
      rowsAsArray: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
      multipleStatements: false,
      // 精确数值使用驱动的大整数和 DECIMAL 字符串，BIT 保持二进制。
      typeCast (field, next) {
        if (field.type === 'JSON') return field.string()
        if (field.type === 'BIT') return field.buffer()
        return next()
      }
    }
    if (config.ssl) options.ssl = { rejectUnauthorized: true, verifyIdentity: true, ...(config.sslCa ? { ca: config.sslCa } : {}) }
    const connection = mysql.createConnection(options)
    connection.on('error', error => {
      if (this.connection === connection) {
        this.connection = null
        this.notify({ type: 'disconnected', message: error.sqlMessage || error.message })
      }
    })
    try {
      await connection.promise().connect()
      return connection
    } catch (error) {
      connection.destroy()
      stream?.destroy()
      throw error
    }
  }

  // 连接和身份测试均由用户点击触发，不自动扫描服务器数据库。
  async connect (input) {
    this.disconnect()
    const generation = this.generation
    const config = { mode: input.mode === 'direct' ? 'direct' : 'ssh', host: String(input.host || '').trim(), port: Number(input.port || 3306), username: String(input.username || ''), password: String(input.password || ''), database: String(input.database || ''), ssl: Boolean(input.ssl), sslCa: String(input.sslCa || '') }
    if (!config.host || !config.username || config.host.length > 255 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('数据库连接设置无效')
    this.config = config
    const connection = await this.createConnection(config)
    if (generation !== this.generation) { connection.destroy(); throw new Error('数据库连接已关闭') }
    this.connection = connection
    try {
      // 读取语句默认至多返回 1001 行，显式大 LIMIT 仍由流式上限保护。
      await this.execute('SET SESSION SQL_SELECT_LIMIT = 1001')
      const [rows] = await this.execute('SELECT VERSION(), DATABASE(), CURRENT_USER()')
      return { version: rows[0][0], database: rows[0][1], user: rows[0][2], mode: config.mode }
    } catch (error) {
      this.disconnect()
      throw error
    }
  }

  // 关闭当前数据库连接，不关闭用户的 SSH 终端。
  disconnect () {
    this.generation++
    const connection = this.connection
    this.connection = null
    this.metadata.clear()
    this.pendingFinish?.(new Error('数据库连接已关闭'))
    if (connection) connection.destroy()
    return { disconnected: true }
  }

  // 元数据和分页读取都带有执行超时，不使用无界的整表读取。
  async execute (sql, values = []) {
    if (!this.connection) throw new Error('数据库连接已断开')
    return this.connection.promise().execute({ sql, timeout: 30000 }, values)
  }

  // 查询当前账号实际有权访问的数据库。
  async databases () {
    const [rows] = await this.execute('SHOW DATABASES')
    return rows.slice(0, 2000).map(row => row[0])
  }

  // 库内同时展示表和视图，行数使用服务器估算，不自动执行 COUNT(*)。
  async tables ({ schema }) {
    identifier(schema)
    const [rows] = await this.execute('SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 2000', [schema])
    return rows.map(row => ({ name: row[0], type: row[1], engine: row[2], estimatedRows: row[3], comment: row[4] }))
  }

  // 加载列、索引和创建 SQL，优先使用主键，其次使用非空的完整唯一索引。
  async tableMetadata (schema, table, refresh = false) {
    const qualified = identifier(schema) + '.' + identifier(table)
    const key = JSON.stringify([schema, table])
    const cached = this.metadata.get(key)
    if (!refresh && cached && Date.now() - cached.time < 60000) return cached.value
    const [rows] = await this.execute('SELECT c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.COLUMN_KEY, c.EXTRA, c.COLUMN_COMMENT, c.DATA_TYPE, t.TABLE_TYPE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? ORDER BY c.ORDINAL_POSITION', [schema, table])
    if (!rows.length) throw new Error('找不到这张表，或当前账号没有权限')
    const columns = rows.map(row => ({ name: row[0], type: row[1], nullable: row[2] === 'YES', default: row[3], key: row[4], extra: row[5] || '', comment: row[6], dataType: row[7], binary: /(?:blob|binary|bit)/i.test(row[7]), generated: /\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(row[5] || '') }))
    const view = rows[0][8] === 'VIEW'
    const [indexRows, fields] = view ? [[], []] : await this.execute('SHOW INDEX FROM ' + qualified)
    const indexes = indexRows.map(row => Object.fromEntries(fields.map((field, i) => [field.name, row[i]])))
    const groups = new Map()
    for (const index of indexes) {
      if (String(index.Non_unique) !== '0') continue
      const entries = groups.get(index.Key_name) || []
      entries.push(index)
      groups.set(index.Key_name, entries)
    }
    const identities = [...groups].filter(([, entries]) => entries.every(index => index.Sub_part === null && typeof index.Column_name === 'string')).sort(([a], [b]) => a === 'PRIMARY' ? -1 : b === 'PRIMARY' ? 1 : 0)
    const identity = identities.map(([, entries]) => entries.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map(index => index.Column_name)).find(names => names.every(name => columns.some(column => column.name === name && !column.nullable))) || []
    let ddl = ''
    try { const [result] = await this.execute('SHOW CREATE TABLE ' + qualified); ddl = result[0]?.[1] || '' } catch (error) {
      if (!['ER_TABLEACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_VIEW_NO_EXPLAIN'].includes(error.code)) throw error
    }
    const value = { schema, table, columns, indexes, identity, ddl, view }
    this.metadata.set(key, { value, time: Date.now() })
    if (this.metadata.size > 32) this.metadata.delete(this.metadata.keys().next().value)
    return value
  }

  // 手动刷新结构时清理对应缓存。
  async structure ({ schema, table }) {
    return this.tableMetadata(schema, table, true)
  }

  // 分页筛选和排序只绑定值、校验列名；大文本和 BLOB 不自动加载到内存。
  async browse ({ schema, table, offset = 0, limit = 100, filter, sort }) {
    const meta = await this.tableMetadata(schema, table)
    const size = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 100)))
    const start = Math.max(0, Math.min(1000000, Math.trunc(Number(offset) || 0)))
    const columns = meta.columns
    const large = columns.map((column, index) => ({ column, index })).filter(({ column }) => /blob|text|json|binary/i.test(column.dataType))
    const projections = columns.map(column => /blob|text|json|binary/i.test(column.dataType) ? `IF(OCTET_LENGTH(${identifier(column.name)}) > ${MAX_CELL}, NULL, ${identifier(column.name)}) AS ${identifier(column.name)}` : identifier(column.name))
    projections.push(...large.map(({ column }) => `OCTET_LENGTH(${identifier(column.name)})`))
    const values = []
    let where = ''
    if (filter?.column) {
      const column = columns.find(column => column.name === filter.column)
      if (!column) throw new Error('筛选列不存在')
      const operators = { contains: 'LIKE', eq: '=', ne: '<>', gt: '>', lt: '<', null: 'IS NULL', notnull: 'IS NOT NULL' }
      const operator = operators[filter.operator]
      if (!operator) throw new Error('筛选方式无效')
      where = ' WHERE ' + identifier(column.name) + ' ' + operator
      if (!['null', 'notnull'].includes(filter.operator)) {
        where += ' ' + (filter.operator === 'contains' ? '?' : comparisonParameter(column))
        values.push(filter.operator === 'contains' ? '%' + String(filter.value || '').replace(/[\\%_]/g, '\\$&') + '%' : String(filter.value ?? ''))
      }
    }
    const order = sort?.column ? [sort.column] : meta.identity
    if (!order.every(name => columns.some(column => column.name === name))) throw new Error('排序列不存在')
    const orderSql = order.length ? ' ORDER BY ' + order.map(identifier).join(', ') + (sort?.direction === 'desc' ? ' DESC' : ' ASC') : ''
    const [raw] = await this.execute(`SELECT ${projections.join(', ')} FROM ${identifier(schema)}.${identifier(table)}${where}${orderSql} LIMIT ${size + 1} OFFSET ${start}`, values)
    const rows = raw.slice(0, size).map(row => {
      const result = row.slice(0, columns.length).map(wireValue)
      large.forEach(({ index }, i) => { const bytes = Number(row[columns.length + i]); if (bytes > MAX_CELL) result[index] = { kind: 'omitted', bytes } })
      return result
    })
    if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > MAX_RESULT) throw new Error('当前页数据超过 8 MiB，请减少每页行数或使用 SQL 选择部分字段')
    return { columns: columns.map(column => ({ name: column.name, type: column.type })), rows, offset: start, limit: size, hasNext: raw.length > size, identity: meta.identity, metadata: meta }
  }

  // 通过键和原始字段做乐观并发检查，不覆盖其他连接刚修改的记录。
  rowCondition (meta, original) {
    if (!meta.identity.length) throw new Error('这张表没有可用主键或唯一键，不能安全编辑和删除')
    if (!Array.isArray(original) || original.length !== meta.columns.length) throw new Error('原始记录无效')
    const values = original.map(bindValue)
    const sql = meta.columns.map(column => {
      const name = identifier(column.name)
      if (/char|text|blob|binary|json|enum|set/.test(column.dataType)) return `CAST(${name} AS BINARY) <=> CAST(? AS BINARY)`
      return name + ' <=> ' + comparisonParameter(column)
    }).join(' AND ')
    return { sql, values }
  }

  // 单行新增、修改和删除均在事务中执行，失败立即回滚。
  async mutate ({ schema, table, kind, original, values }) {
    const meta = await this.tableMetadata(schema, table, true)
    if (meta.view) throw new Error('视图在数据面板中只读，请通过 SQL 修改')
    const qualified = identifier(schema) + '.' + identifier(table)
    const connection = this.connection
    await connection.promise().beginTransaction()
    try {
      let result
      if (kind === 'insert' || kind === 'update') {
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('字段内容无效')
        const entries = Object.entries(values)
        for (const [name, value] of entries) {
          const column = meta.columns.find(column => column.name === name)
          if (!column || column.generated) throw new Error('不能修改不存在或自动生成的字段')
          if (value === null && !column.nullable) throw new Error(name + ' 不允许 NULL')
        }
        const bound = entries.map(([, value]) => bindValue(value))
        if (kind === 'insert') {
          const sql = entries.length ? `INSERT INTO ${qualified} (${entries.map(([name]) => identifier(name)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})` : `INSERT INTO ${qualified} () VALUES ()`
          ;[result] = await this.execute(sql, bound)
        } else {
          if (!entries.length) { await connection.promise().commit(); return { affectedRows: 0 } }
          const condition = this.rowCondition(meta, original)
          ;[result] = await this.execute(`UPDATE ${qualified} SET ${entries.map(([name]) => identifier(name) + ' = ?').join(', ')} WHERE ${condition.sql} LIMIT 1`, [...bound, ...condition.values])
          if (result.affectedRows !== 1) throw new Error('记录已经被修改或删除，请刷新后重试')
        }
      } else if (kind === 'delete') {
        const condition = this.rowCondition(meta, original)
        ;[result] = await this.execute(`DELETE FROM ${qualified} WHERE ${condition.sql} LIMIT 1`, condition.values)
        if (result.affectedRows !== 1) throw new Error('记录已经被修改或删除，请刷新后重试')
      } else throw new Error('数据修改方式无效')
      await connection.promise().commit()
      return { affectedRows: result.affectedRows, insertId: String(result.insertId || '') }
    } catch (error) {
      await connection.promise().rollback().catch(() => {})
      throw error
    }
  }

  // 通过独立控制连接中止当前账号自己的查询，主连接仍可继续使用。
  async killQuery () {
    const threadId = this.connection?.threadId
    if (!Number.isSafeInteger(threadId)) return
    const control = await this.createConnection(this.config)
    try { await control.promise().query('KILL QUERY ' + threadId) } finally { control.destroy() }
  }

  // 用户取消时不改变已经提交的数据，只中止正在执行的语句。
  async cancel () {
    if (!this.busy || !this.connection) return { cancelled: false }
    this.cancelled = true
    await this.killQuery()
    return { cancelled: true }
  }

  // 流式读取 SQL 结果，限制行数和字节数，不等待百万行进入内存。
  async statement (sql, byteLimit = MAX_RESULT) {
    const started = performance.now()
    const connection = this.connection
    let limited = false
    let timedOut = false
    let stopping = false
    let stopTask = null
    let settled = false
    let bytes = 0
    let columns = []
    let summary = null
    const rows = []
    return new Promise((resolve, reject) => {
      // 上限或超时触发一次控制请求，失败时关闭主连接以停止继续传输。
      const stop = () => {
        if (stopping) return
        stopping = true
        stopTask = this.killQuery().catch(() => { connection.destroy(); this.connection = null })
      }
      const timer = setTimeout(() => { timedOut = true; stop() }, 30000)
      const query = connection.query({
        sql,
        // 自由 SQL 使用文本协议，可按服务器原始文本保留所有数字。
        typeCast (field, next) {
          if (NUMERIC_TYPES.has(field.type) || field.type === 'JSON') return field.string()
          if (field.type === 'BIT') return field.buffer()
          return next()
        }
      })
      query.on('fields', fields => { columns = resultColumns(fields) })
      query.on('result', row => {
        if (!Array.isArray(row)) { summary = { affectedRows: row.affectedRows || 0, insertId: String(row.insertId || '0'), warnings: row.warningStatus || 0 }; return }
        if (limited || this.cancelled || timedOut) return
        const encoded = row.map(wireValue)
        bytes += Buffer.byteLength(JSON.stringify(encoded), 'utf8')
        if (rows.length >= MAX_SQL_ROWS || bytes > byteLimit) { limited = true; stop(); return }
        rows.push(encoded)
      })
      // 只返回结果概要，SQL 错误不写入终端或日志。
      const finish = async error => {
        if (settled) return
        settled = true
        if (this.pendingFinish === finish) this.pendingFinish = null
        clearTimeout(timer)
        if (stopTask) await stopTask
        if (this.cancelled) return reject(new Error('查询已取消'))
        if (timedOut) return reject(new Error('查询超过 30 秒，已请求中止'))
        if (error && !limited) return reject(error)
        resolve({ sql, columns, rows, summary, limited, elapsed: Math.round(performance.now() - started) })
      }
      this.pendingFinish = finish
      query.once('error', finish)
      query.once('end', () => finish())
    })
  }

  // 脚本按语句顺序执行，写入语句必须由界面明确确认。
  async query ({ sql, schema, allowWrite }) {
    const { splitSql, isReadSql } = await import('../common/mysql-sql.mjs')
    const statements = splitSql(sql)
    if (!allowWrite && statements.some(statement => !isReadSql(statement))) throw new Error('这段 SQL 可能修改数据，请确认后执行')
    this.cancelled = false
    if (schema) await this.execute('USE ' + identifier(schema))
    const results = []
    let remaining = MAX_RESULT
    for (const statement of statements) {
      if (this.cancelled) throw new Error('查询已取消')
      const result = await this.statement(statement, remaining)
      remaining -= Buffer.byteLength(JSON.stringify(result), 'utf8')
      results.push(result)
      if (result.limited || remaining <= 0) { result.limited = true; break }
    }
    this.metadata.clear()
    return results
  }
}

// 本地 WebSocket 只接受上面的固定数据库操作，连接与所在面板共同销毁。
function registerMysql (app, verify, getSsh, connected = () => {}) {
  app.ws('/mysql/:tabId', (ws, req) => {
    verify(req)
    connected()
    const session = new MysqlSession(() => getSsh?.(req.params.tabId), data => { if (ws.readyState === 1) ws.send(JSON.stringify({ event: data })) })
    ws.on('message', async raw => {
      let id
      try {
        if (raw.length > 2 * 1024 * 1024) throw new Error('数据库请求过大')
        const message = JSON.parse(raw.toString())
        id = message.id
        const result = await session.dispatch(message.action, message.body)
        if (ws.readyState === 1) ws.send(JSON.stringify({ id, data: result }))
      } catch (error) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ id, error: { message: String(error.sqlMessage || error.message || '数据库操作失败').slice(0, 1500) } }))
      }
    })
    ws.on('close', () => session.disconnect())
    ws.on('error', () => session.disconnect())
  })
}

module.exports = { MysqlSession, registerMysql, identifier, wireValue, bindValue }
