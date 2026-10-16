const { dbAction } = require('./db')
const generate = require('../common/uid')

// 只保存数据库连接需要的字段，密码和 SQL 收藏随记录一起加密。
function validateProfile (input) {
  const profile = {
    _id: typeof input.id === 'string' && input.id ? input.id : generate(),
    title: String(input.title || '').trim().slice(0, 100),
    mode: input.mode === 'direct' ? 'direct' : 'ssh',
    host: String(input.host || '').trim(),
    port: Number(input.port || 3306),
    username: String(input.username || '').trim(),
    password: String(input.password || ''),
    database: String(input.database || '').trim(),
    ssl: Boolean(input.ssl),
    sslCa: String(input.sslCa || ''),
    sshBookmarkId: String(input.sshBookmarkId || ''),
    shellBookmarkId: String(input.shellBookmarkId || ''),
    lastSelectedAt: Math.max(0, Number(input.lastSelectedAt) || 0),
    snippets: Array.isArray(input.snippets) ? input.snippets.slice(0, 30).map(item => ({ id: String(item.id || generate()), title: String(item.title || '查询').slice(0, 80), sql: String(item.sql || '').slice(0, 65536) })) : [],
    history: Array.isArray(input.history) ? input.history.slice(0, 30).map(item => ({ sql: String(item.sql || '').slice(0, 65536), time: Number(item.time), elapsed: Number(item.elapsed || 0) })) : []
  }
  if (!profile.title || !profile.host || !profile.username) throw new Error('请填写连接名称、地址和用户名')
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error('数据库端口无效')
  if (profile.host.length > 255 || profile.password.length > 8192 || profile.sslCa.length > 65536) throw new Error('连接设置过长')
  return profile
}

// 读取保存的连接，交由受信任的本地界面展示和选择。
exports.listDatabaseConnections = async function () {
  const profiles = await dbAction('databaseConnections', 'find')
  return profiles.map(({ _id, ...profile }) => ({ id: _id, ...profile }))
}

// 写入连接时数据库层强制检查系统加密，失败不会写入明文密码。
exports.saveDatabaseConnection = async function (input) {
  const profile = validateProfile(input)
  await dbAction('databaseConnections', 'insert', profile)
  const { _id, ...rest } = profile
  return { id: _id, ...rest }
}

// 从最新记录只更新使用时间，不用旧标签里的配置覆盖密码或 SQL 收藏。
exports.rememberDatabaseConnection = async function (id) {
  if (typeof id !== 'string' || !id) throw new Error('连接编号无效')
  const profile = await dbAction('databaseConnections', 'findOne', { _id: id })
  if (!profile) throw new Error('数据库连接收藏已删除，请重新选择')
  const saved = { ...profile, lastSelectedAt: Date.now() }
  await dbAction('databaseConnections', 'insert', saved)
  const { _id, ...rest } = saved
  return { id: _id, ...rest }
}

// 删除连接收藏，不触碰远程数据库。
exports.deleteDatabaseConnection = async function (id) {
  if (typeof id !== 'string' || !id) throw new Error('连接编号无效')
  return dbAction('databaseConnections', 'remove', { _id: id })
}
