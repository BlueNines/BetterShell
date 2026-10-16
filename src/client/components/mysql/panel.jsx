import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Input, Modal, Select, Spin, Table, Tabs, Tooltip } from 'antd'
import { DatabaseOutlined, TableOutlined, EyeOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, PlayCircleOutlined, StopOutlined, DownloadOutlined, SaveOutlined, CopyOutlined, HistoryOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DisconnectOutlined, MinusOutlined, EyeInvisibleOutlined, ExpandOutlined } from '@ant-design/icons'
import { refs } from '../common/ref'
import MysqlClient from './client'
import DatabaseGrid from './grid'
import DatabaseConnectionDialog from './connection-dialog'
import MysqlObjectBrowser from './object-browser'
import { databaseOwner, availableDatabaseProfiles, defaultDatabaseProfile } from './profiles'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'
import { cellText, quoteName, toCsv, exportText } from './values'
import { splitSql, isReadSql } from '../../../app/common/mysql-sql.mjs'
import uid from '../../common/uid'
import './mysql.styl'

// 普通结果随工作区保留，超大结果不复制进启动快照以控制内存占用。
function boundedResult (value, fallback) {
  if (!value) return fallback
  const text = JSON.stringify(value)
  return text.length <= 1024 * 1024 && new TextEncoder().encode(text).byteLength <= 1024 * 1024 ? value : fallback
}

// 每个终端标签拥有自己的数据库工作区，查询和编辑不会写进 shell。
export default function DatabasePanel ({ tab, height, mode = 'expanded', active = true, onMinimize, onHide, onRestore }) {
  const savedWorkspace = useRef(getWorkspaceState(tab.id, 'mysql')).current
  const restoreAttempted = useRef(false)
  const [modal, modalContext] = Modal.useModal()
  const [profiles, setProfiles] = useState([])
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [profile, setProfile] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [connected, setConnected] = useState(false)
  const [connectionWanted, setConnectionWanted] = useState(Boolean(savedWorkspace.connected))
  const [server, setServer] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [databases, setDatabases] = useState([])
  const [tables, setTables] = useState({})
  const [schema, setSchema] = useState(savedWorkspace.schema || '')
  const [table, setTable] = useState(savedWorkspace.table || '')
  const [treeSearch, setTreeSearch] = useState(savedWorkspace.treeSearch || '')
  const [result, setResult] = useState(savedWorkspace.result || null)
  const [selected, setSelected] = useState(savedWorkspace.selected ?? null)
  const [offset, setOffset] = useState(savedWorkspace.offset || 0)
  const [pageSize, setPageSize] = useState(savedWorkspace.pageSize || 100)
  const [sort, setSort] = useState(savedWorkspace.sort || null)
  const [filter, setFilter] = useState(savedWorkspace.filter || { column: '', operator: 'contains', value: '' })
  const [activeTab, setActiveTab] = useState(savedWorkspace.activeTab || 'data')
  const [sql, setSql] = useState(savedWorkspace.sql || '')
  const [queryResults, setQueryResults] = useState(savedWorkspace.queryResults || [])
  const [queryIndex, setQueryIndex] = useState(savedWorkspace.queryIndex || '0')
  const [record, setRecord] = useState(savedWorkspace.record || null)
  const [cell, setCell] = useState(null)
  const [snippetName, setSnippetName] = useState('')
  const [snippetDialog, setSnippetDialog] = useState(false)
  const [historyDialog, setHistoryDialog] = useState(false)
  const sqlInput = useRef(null)
  const alive = useRef(true)
  const client = useMemo(() => new MysqlClient(tab.id, event => {
    if (alive.current && event.type === 'disconnected') { setConnected(false); setBusy(false); setError(event.message) }
  }), [tab.id])
  const bookmarkId = databaseOwner(tab, window.store.bookmarks)
  const expanded = mode === 'expanded'
  const available = useMemo(() => availableDatabaseProfiles(profiles, bookmarkId), [profiles, bookmarkId])
  const meta = result?.metadata
  const editable = Boolean(meta?.identity.length && !meta?.view)
  const selectedRow = selected !== null ? result?.rows[selected] : null
  const completeRow = Boolean(selectedRow && !selectedRow.some(value => value?.kind === 'omitted'))
  const retainedResults = useMemo(() => boundedResult(queryResults, []), [queryResults])
  const retainedData = useMemo(() => boundedResult(result, null), [result])
  useWorkspaceState(tab.id, 'mysql', () => ({ profileId: profile?.id || savedWorkspace.profileId || '', connected: connectionWanted, schema, table, treeSearch, result: retainedData, selected, offset, pageSize, sort, filter, activeTab, sql, queryResults: retainedResults, queryIndex, record }), [profile?.id, connectionWanted, schema, table, treeSearch, retainedData, selected, offset, pageSize, sort, filter, activeTab, sql, retainedResults, queryIndex, record])

  useEffect(() => {
    alive.current = true
    window.pre.runGlobalAsync('listDatabaseConnections').then(items => {
      if (!alive.current) return
      setProfiles(items)
      setProfilesLoaded(true)
    }).catch(error => { if (alive.current) setError(error.message) })
    return () => { alive.current = false; client.close() }
  }, [client])

  useEffect(() => {
    if (profilesLoaded) setProfile(previous => previous || available.find(item => item.id === savedWorkspace.profileId) || defaultDatabaseProfile(available))
  }, [profilesLoaded, available])

  useEffect(() => {
    if (restoreAttempted.current || !profilesLoaded || !profile || !savedWorkspace.connected || profile.id !== savedWorkspace.profileId) return
    if (profile.mode === 'ssh' && tab.status !== 'success') return
    restoreAttempted.current = true
    connectProfile(profile, true)
  }, [profilesLoaded, profile?.id, tab.status])

  // 所有远程操作共用忙碌状态和错误区域，迟到响应不更新已销毁面板。
  async function perform (action) {
    if (busy) return
    setBusy(true)
    setError('')
    try { return await action() } catch (error) {
      if (alive.current) setError(error.message)
    } finally { if (alive.current) setBusy(false) }
  }

  // 保存连接只写入本地加密库，不建立数据库网络连接。
  async function persist (values) {
    const saved = await window.pre.runGlobalAsync('saveDatabaseConnection', { ...values, sshBookmarkId: values.mode === 'ssh' ? bookmarkId : '' })
    if (alive.current) {
      setProfile(saved)
      setProfiles(items => [...items.filter(item => item.id !== saved.id), saved])
    }
    return saved
  }

  // 记住用户选中的收藏，当前标签保留自己的实际连接和工作状态。
  async function remember (item) {
    const saved = await window.pre.runGlobalAsync('rememberDatabaseConnection', item.id)
    if (alive.current) {
      setProfile(saved)
      setProfiles(items => items.map(profile => profile.id === saved.id ? saved : profile))
    }
    return saved
  }

  // 从已有列表选择时不重新填写账号，并将选择保存供下次打开恢复。
  async function selectProfile (item) {
    if (!item) return
    disconnect()
    setProfile(item)
    await perform(() => remember(item))
  }

  // 按用户选择使用已有 SSH 通道或直连，成功后才列出数据库。
  async function connectProfile (item, restoring = false) {
    if (!item) return
    await perform(async () => {
      setConnectionWanted(true)
      const port = item.mode === 'ssh' ? refs.get('term-' + tab.id)?.port : window.store.config.port
      if (!port || (item.mode === 'ssh' && tab.status !== 'success')) throw new Error('请先连接当前 SSH 服务器')
      setConnected(false)
      const saved = await remember(item)
      const info = await client.connect(saved, port)
      const names = await client.request('databases')
      if (!alive.current) return
      setServer(info)
      setProfile(saved)
      setConnected(true)
      setDatabases(names)
      setTables({})
      const name = restoring ? savedWorkspace.schema || info.database || '' : info.database || ''
      setSchema(name)
      if (name) await loadTables(name)
      if (restoring && name && savedWorkspace.table) {
        await browse(name, savedWorkspace.table, savedWorkspace.offset || 0, savedWorkspace.pageSize || 100, savedWorkspace.sort, savedWorkspace.filter)
        setSelected(savedWorkspace.selected ?? null)
      } else {
        setTable('')
        setResult(null)
        if (!restoring) setQueryResults([])
      }
    })
  }

  // 表单保存成功后允许继续连接，连接失败不会丢失填写的配置。
  async function saveConnection (values, connect) {
    try {
      const saved = await persist({ ...values, shellBookmarkId: bookmarkId, lastSelectedAt: Date.now() })
      setDialog(null)
      if (connect) await connectProfile(saved)
    } catch (error) { setError(error.message) }
  }

  // 主动断开只影响数据库，不影响 shell 和 SFTP。
  function disconnect () {
    setConnectionWanted(false)
    client.close()
    setConnected(false)
    setServer(null)
    setBusy(false)
  }

  // 删除本地连接收藏不删除远程数据，正在使用该连接时先释放数据库通道。
  function deleteConnection (item) {
    modal.confirm({
      title: '删除数据库连接收藏？',
      content: item.title,
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        if (profile?.id === item.id) { disconnect(); setProfile(null) }
        await window.pre.runGlobalAsync('deleteDatabaseConnection', item.id)
        setProfiles(items => items.filter(profile => profile.id !== item.id))
        setDialog(null)
      }
    })
  }

  // 懒加载展开的数据库，不扫描所有库中的表。
  async function loadTables (name) {
    const list = await client.request('tables', { schema: name })
    if (alive.current) setTables(previous => ({ ...previous, [name]: list }))
    return list
  }

  // 读取一页记录，保留筛选和排序，并将列结构用于编辑校验。
  async function browse (name = schema, item = table, page = offset, size = pageSize, ordering = sort, condition = filter) {
    if (!name || !item) return
    const data = await client.request('browse', { schema: name, table: item, offset: page, limit: size, sort: ordering, filter: condition })
    if (!alive.current) return
    setResult(data)
    setOffset(data.offset)
    setSelected(null)
  }

  // 切换表时重新计算分页，避免把上张表的排序字段带入新表。
  async function openTable (name, item) {
    await perform(async () => {
      if (!tables[name]) await loadTables(name)
      setSchema(name)
      setTable(item)
      setSort(null)
      setFilter({ column: '', operator: 'contains', value: '' })
      setOffset(0)
      setActiveTab('data')
      await browse(name, item, 0, pageSize, null, null)
    })
  }

  // 列标题排序由后端校验列名，分页数据不在浏览器里假排序。
  async function sortColumn (name) {
    const ordering = { column: name, direction: sort?.column === name && sort.direction === 'asc' ? 'desc' : 'asc' }
    setSort(ordering)
    await perform(() => browse(schema, table, 0, pageSize, ordering))
  }

  // 刷新对象列表和当前页，DDL 更改后的列也会重新加载。
  async function refresh () {
    await perform(async () => {
      const names = await client.request('databases')
      setDatabases(names)
      if (schema) await loadTables(schema)
      if (table) {
        const structure = await client.request('structure', { schema, table })
        const names = new Set(structure.columns.map(column => column.name))
        const ordering = sort && names.has(sort.column) ? sort : null
        const condition = names.has(filter.column) ? filter : { column: '', operator: 'contains', value: '' }
        setSort(ordering)
        setFilter(condition)
        await browse(schema, table, offset, pageSize, ordering, condition)
      }
    })
  }

  // 创建或修改记录时区分默认值、NULL 和空字符串。
  function openRecord (kind, rowIndex = selected, focus = 0) {
    if (!meta) return
    const row = kind === 'insert' ? null : result.rows[rowIndex]
    const values = Object.fromEntries(meta.columns.map((column, index) => [column.name, row ? row[index] : '']))
    const modes = Object.fromEntries(meta.columns.map((column, index) => [column.name, row ? row[index] === null ? 'null' : 'value' : column.default !== null || /auto_increment/i.test(column.extra) || column.generated ? 'default' : column.nullable ? 'null' : 'value']))
    setRecord({ kind, row, values, modes, focus })
    requestAnimationFrame(() => document.getElementById(`mysql-field-${tab.id}-${focus}`)?.focus())
  }

  // 双击数据单元格进入记录编辑，查询结果和只读表提供完整值查看。
  function openCell (rowIndex, columnIndex, source = result, readOnly = false) {
    setSelected(rowIndex)
    const row = source.rows[rowIndex]
    if (!readOnly && editable && !row.some(value => value?.kind === 'omitted')) openRecord('update', rowIndex, columnIndex)
    else setCell({ name: source.columns[columnIndex].name, value: row[columnIndex] })
  }

  // 更新只提交真正改变的字段，原始值随请求用于并发检查。
  async function saveRecord () {
    if (!record || !meta) return
    await perform(async () => {
      const values = {}
      for (let i = 0; i < meta.columns.length; i++) {
        const column = meta.columns[i]
        if (column.generated || record.modes[column.name] === 'default') continue
        const value = record.modes[column.name] === 'null' ? null : record.values[column.name]
        if (record.kind === 'insert' || JSON.stringify(value) !== JSON.stringify(record.row[i])) Object.defineProperty(values, column.name, { value, enumerable: true })
      }
      await client.request('mutate', { schema, table, kind: record.kind, original: record.row, values })
      setRecord(null)
      await browse()
    })
  }

  // 删除前显示定位键，删除动作最多影响这一条匹配原始值的记录。
  function deleteRecord () {
    if (!completeRow || !editable) return
    modal.confirm({ title: '删除这一条记录？', content: meta.identity.map(name => `${name} = ${cellText(selectedRow[meta.columns.findIndex(column => column.name === name)])}`).join('，'), okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => perform(async () => { await client.request('mutate', { schema, table, kind: 'delete', original: selectedRow }); await browse() }) })
  }

  // 执行选中的 SQL，未选择文本时执行整个编辑器。
  async function runSql (confirmed = false, text) {
    if (!connected || busy) return
    const textarea = sqlInput.current?.resizableTextArea?.textArea
    const query = text || (textarea?.selectionStart !== textarea?.selectionEnd ? sql.slice(textarea.selectionStart, textarea.selectionEnd) : sql)
    let statements
    try { statements = splitSql(query) } catch (error) { setError(error.message); return }
    if (!confirmed && statements.some(statement => !isReadSql(statement))) {
      modal.confirm({ title: '执行会修改数据或结构的 SQL？', content: '请确认 SQL 中的数据库、表和条件。脚本按语句顺序执行，可使用 BEGIN / COMMIT 控制事务。', okText: '执行', cancelText: '取消', onOk: () => runSql(true, query) })
      return
    }
    await perform(async () => {
      const results = await client.request('query', { sql: query, schema, allowWrite: confirmed })
      setQueryResults(results)
      setQueryIndex('0')
      const elapsed = results.reduce((total, item) => total + item.elapsed, 0)
      if (profile) await persist({ ...profile, history: [{ sql: query, time: Date.now(), elapsed }, ...(profile.history || [])].slice(0, 30) })
    })
  }

  // 导出的是当前页或当前查询结果，避免后台无界地读取整张表。
  async function exportResult (format) {
    const source = activeTab === 'sql' ? queryResults[Number(queryIndex)] : result
    if (!source?.columns.length) return
    const name = `${schema || '查询'}-${table || '结果'}`.replace(/[<>:"/\\|?*\0]/g, '_')
    const file = await window.api.saveDialog({ defaultPath: name + '.' + format, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (!file?.filePath) return
    const contents = format === 'csv' ? toCsv(source) : JSON.stringify({ columns: source.columns, rows: source.rows.map(row => row.map(exportText)) }, null, 2)
    try {
      const saved = await window.fs.writeFile(file.filePath, contents)
      if (!saved) throw new Error('导出失败，请检查目标目录是否可写')
    } catch (error) { setError(error.message) }
  }

  // SQL 收藏随连接加密保存，重新启动后仍可选择。
  async function saveSnippet () {
    if (!profile || !snippetName.trim() || !sql.trim()) return
    await persist({ ...profile, snippets: [{ id: uid(), title: snippetName.trim(), sql }, ...(profile.snippets || [])].slice(0, 30) }).catch(error => setError(error.message))
    setSnippetDialog(false)
  }

  // 新建表只生成 SQL 草稿，编辑并点击执行后才改变数据库。
  function newTable () {
    setActiveTab('sql')
    setSql(`CREATE TABLE ${quoteName(schema)}.\`new_table\` (\n  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n  \`name\` VARCHAR(255) NOT NULL DEFAULT '',\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`)
  }

  // 按需读取一个数据库的表清单，不扫描未展开的库。
  async function loadTreeDatabase (node) {
    const [type, name] = JSON.parse(node.key)
    if (type === 'database' && !tables[name]) await perform(() => loadTables(name))
  }

  // 库表树和顶部选择器共用同一套切换逻辑。
  function selectTreeObject (keys) {
    if (!keys[0]) return
    const [type, name, item] = JSON.parse(keys[0])
    if (type === 'table') openTable(name, item)
    else { setSchema(name); if (!tables[name]) perform(() => loadTables(name)) }
  }

  const treeData = useMemo(() => databases.map(name => {
    const children = (tables[name] || []).filter(item => item.name.toLowerCase().includes(treeSearch.toLowerCase())).map(item => ({ key: JSON.stringify(['table', name, item.name]), title: item.name, isLeaf: true, icon: item.type === 'VIEW' ? <EyeOutlined /> : <TableOutlined /> }))
    return { key: JSON.stringify(['database', name]), title: name, icon: <DatabaseOutlined />, children: tables[name] ? children : undefined }
  }).filter(node => !treeSearch || node.title.toLowerCase().includes(treeSearch.toLowerCase()) || node.children?.length), [databases, tables, treeSearch])
  const dataButtons = <div className='mysql-actions'><Button size='small' icon={<PlusOutlined />} disabled={busy || !meta || meta.view} onClick={() => openRecord('insert')}>新增</Button><Button size='small' icon={<EditOutlined />} disabled={busy || !editable || !completeRow} onClick={() => openRecord('update')}>编辑</Button><Button size='small' danger icon={<DeleteOutlined />} disabled={busy || !editable || !completeRow} onClick={deleteRecord}>删除</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'csv', label: '导出当前页 CSV' }, { key: 'json', label: '导出当前页 JSON' }], onClick: ({ key }) => exportResult(key) }} disabled={!result?.columns.length}><Button size='small' icon={<DownloadOutlined />}>导出</Button></Dropdown><span className='mysql-table-caption' title={schema + '.' + table}>{table || '表数据'}</span></div>
  const dataView = <div className='mysql-data-view'>{dataButtons}{meta && !editable && <div className='mysql-readonly-note'>{meta.view ? '视图只读' : '没有非空主键或唯一键，编辑和删除不可用；仍可查看和新增。'}</div>}<div className='mysql-filter'><Select size='small' aria-label='筛选列' value={filter.column || undefined} allowClear placeholder='筛选列' options={(meta?.columns || []).map(column => ({ value: column.name, label: column.name }))} onChange={column => setFilter(previous => ({ ...previous, column: column || '' }))} /><Select size='small' value={filter.operator} options={[{ value: 'contains', label: '包含' }, { value: 'eq', label: '=' }, { value: 'ne', label: '≠' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }, { value: 'null', label: 'NULL' }, { value: 'notnull', label: '非 NULL' }]} onChange={operator => setFilter(previous => ({ ...previous, operator }))} /><Input size='small' aria-label='筛选值' value={filter.value} disabled={['null', 'notnull'].includes(filter.operator)} onChange={event => setFilter(previous => ({ ...previous, value: event.target.value }))} onPressEnter={() => perform(() => browse(schema, table, 0))} /><Button size='small' disabled={busy || !table} onClick={() => perform(() => browse(schema, table, 0))}>筛选</Button></div><DatabaseGrid tabId={tab.id} workspacePart='mysqlDataGrid' resetKey={JSON.stringify([schema, table, offset, pageSize, sort, filter])} result={result} selected={selected} onSelect={setSelected} onOpenCell={openCell} onSort={name => sortColumn(name)} sort={sort} /><div className='mysql-pagination'><span>{result?.rows.length ? `${offset + 1}–${offset + result.rows.length} 行` : '0 行'}</span><Select size='small' aria-label='每页行数' value={pageSize} options={[20, 50, 100, 200].map(value => ({ value, label: value + ' / 页' }))} onChange={size => { setPageSize(size); perform(() => browse(schema, table, 0, size)) }} /><Button size='small' disabled={busy || !offset} onClick={() => perform(() => browse(schema, table, Math.max(0, offset - pageSize)))}>上一页</Button><Button size='small' disabled={busy || !result?.hasNext} onClick={() => perform(() => browse(schema, table, offset + pageSize))}>下一页</Button></div></div>
  const structureView = meta
    ? (
      <Tabs
        className='mysql-structure-tabs' size='small' items={[
          { key: 'columns', label: '字段', children: <Table virtual size='small' pagination={false} rowKey='name' scroll={{ x: 720, y: Math.max(100, height - 205) }} dataSource={meta.columns} columns={[{ title: '字段', dataIndex: 'name', width: 140 }, { title: '类型', dataIndex: 'type', width: 150 }, { title: 'NULL', dataIndex: 'nullable', width: 60, render: value => value ? '是' : '否' }, { title: '默认值', dataIndex: 'default', width: 100, render: value => value === null ? 'NULL' : value }, { title: '键', dataIndex: 'key', width: 65 }, { title: '附加', dataIndex: 'extra', width: 140 }, { title: '注释', dataIndex: 'comment', width: 180 }]} /> },
          { key: 'indexes', label: '索引', children: <Table virtual size='small' pagination={false} rowKey={row => row.Key_name + ':' + row.Seq_in_index} scroll={{ x: 600, y: Math.max(100, height - 205) }} dataSource={meta.indexes} columns={[{ title: '名称', dataIndex: 'Key_name', width: 130 }, { title: '列', dataIndex: 'Column_name', width: 130 }, { title: '顺序', dataIndex: 'Seq_in_index', width: 70 }, { title: '唯一', dataIndex: 'Non_unique', width: 70, render: value => String(value) === '0' ? '是' : '否' }, { title: '类型', dataIndex: 'Index_type', width: 100 }]} /> },
          { key: 'ddl', label: '创建 SQL', children: <div className='mysql-ddl'><Button size='small' icon={<CopyOutlined />} onClick={() => window.pre.writeClipboard(meta.ddl)}>复制</Button><Input.TextArea readOnly value={meta.ddl || '当前账号没有查看创建 SQL 的权限'} /></div> }
        ]}
      />
      )
    : <div className='mysql-empty'>选择一张表查看结构</div>
  const currentQuery = queryResults[Number(queryIndex)]
  const sqlView = <div className='mysql-sql-view'><div className='mysql-actions'><Button size='small' type='primary' icon={<PlayCircleOutlined />} disabled={busy} onClick={() => runSql()}>运行</Button><Button size='small' icon={<StopOutlined />} disabled={!busy} onClick={() => client.request('cancel').catch(error => setError(error.message))}>停止</Button><Tooltip title='保存 SQL 收藏'><Button size='small' aria-label='保存 SQL 收藏' icon={<SaveOutlined />} onClick={() => { setSnippetName(''); setSnippetDialog(true) }} disabled={!sql.trim()} /></Tooltip><Tooltip title='查询历史'><Button size='small' aria-label='查询历史' icon={<HistoryOutlined />} onClick={() => setHistoryDialog(true)} /></Tooltip><Select size='small' aria-label='SQL 收藏' placeholder='已保存查询' allowClear value={undefined} options={(profile?.snippets || []).map(item => ({ value: item.id, label: item.title }))} onChange={id => { const saved = profile?.snippets?.find(item => item.id === id); if (saved) setSql(saved.sql) }} /><span className='mysql-sql-shortcut'>Ctrl + Enter</span></div><Input.TextArea ref={sqlInput} className='mysql-sql-editor' aria-label='SQL 编辑器' value={sql} spellCheck={false} placeholder='输入 SQL，或选中部分语句后运行。修改数据的语句执行前会确认。' onChange={event => setSql(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); runSql() } }} /><div className='mysql-query-result-bar'><Select size='small' aria-label='查询结果集' value={queryIndex} options={queryResults.map((item, index) => ({ value: String(index), label: `结果 ${index + 1} · ${item.rows.length} 行 · ${item.elapsed} ms` }))} onChange={setQueryIndex} /><Dropdown trigger={['click']} menu={{ items: [{ key: 'csv', label: '导出结果 CSV' }, { key: 'json', label: '导出结果 JSON' }], onClick: ({ key }) => exportResult(key) }} disabled={!currentQuery?.columns.length}><Button size='small' icon={<DownloadOutlined />}>导出结果</Button></Dropdown></div>{currentQuery?.limited && <div className='mysql-readonly-note'>结果已限制为前 1000 行或 8 MiB，请增加 WHERE 或 LIMIT 缩小范围。</div>}{currentQuery?.summary && <div className='mysql-query-summary'>执行成功 · 影响 {currentQuery.summary.affectedRows} 行{currentQuery.summary.insertId !== '0' && ` · 新编号 ${currentQuery.summary.insertId}`}</div>}<DatabaseGrid tabId={tab.id} workspacePart='mysqlSqlGrid' result={currentQuery} selected={selected} onSelect={setSelected} onOpenCell={(row, column) => openCell(row, column, currentQuery, true)} /></div>

  return (
    <section className={'mysql-panel' + (mode === 'minimized' ? ' mysql-minimized' : '')} data-tab-id={tab.id} data-mode={mode} aria-label={'MySQL 工作区 · ' + (tab.title || '本机终端')}>
      {modalContext}
      {mode === 'minimized' && <div className='mysql-minimized-rail'><Tooltip title='恢复 MySQL 工作区' placement='left'><Button size='small' type='text' aria-label='恢复 MySQL 面板' icon={<ExpandOutlined />} onClick={onRestore} /></Tooltip><DatabaseOutlined /><span className='mysql-rail-title'>MySQL</span><span className={connected ? 'mysql-rail-status connected' : 'mysql-rail-status'} title={busy ? '正在查询' : connected ? '数据库已连接' : '数据库未连接'}>{busy ? '◌' : '●'}</span><Tooltip title='隐藏 MySQL 工作区' placement='left'><Button size='small' type='text' aria-label='隐藏 MySQL 面板' icon={<EyeInvisibleOutlined />} onClick={onHide} /></Tooltip></div>}
      <div className='mysql-expanded' hidden={!expanded}>
        <div className='mysql-titlebar'><strong><DatabaseOutlined /> MySQL</strong><span className='mysql-tab-caption' title={tab.title}>{tab.title || '本机终端'}</span><Tooltip title='最小化为右侧窄栏'><Button size='small' type='text' aria-label='最小化 MySQL 面板' icon={<MinusOutlined />} onClick={onMinimize} /></Tooltip><Tooltip title='隐藏；通过工具栏的数据库按钮恢复'><Button size='small' type='text' aria-label='隐藏 MySQL 面板' icon={<EyeInvisibleOutlined />} onClick={onHide} /></Tooltip></div>
        <div className='mysql-header'><Select size='small' aria-label='选择数据库连接' disabled={busy} placeholder={profilesLoaded ? '选择已保存连接' : '正在读取连接'} value={profile?.id} options={available.map(item => ({ value: item.id, label: item.title }))} onChange={id => { const item = available.find(item => item.id === id); selectProfile(item) }} /><Tooltip title='新建数据库连接'><Button size='small' type='text' aria-label='新建数据库连接' disabled={busy} icon={<PlusOutlined />} onClick={() => setDialog({})} /></Tooltip><Tooltip title='编辑数据库连接'><Button size='small' type='text' aria-label='编辑数据库连接' icon={<EditOutlined />} disabled={!profile || busy} onClick={() => setDialog(profile)} /></Tooltip>{connected ? <Button size='small' type='text' icon={<DisconnectOutlined />} onClick={disconnect}>断开</Button> : <Button size='small' type='primary' disabled={!profile || busy} onClick={() => connectProfile(profile)}>连接</Button>}</div>
        {error && <Alert className='mysql-error' type='error' message={error} closable onClose={() => setError('')} showIcon />}
        {!connected
          ? <div className='mysql-connect-welcome'><DatabaseOutlined /><h3>{profile ? '连接已保存' : '数据库就在终端旁边'}</h3><p>{profile ? '已恢复此服务器的数据库配置，点击连接即可使用。' : <>浏览 MySQL / MariaDB 的表、数据和结构，<br />运行 SQL、修改记录并导出结果。</>}</p>{profilesLoaded && <span className='mysql-saved-note'>当前服务器已保存 {available.length} 个连接</span>}<Button type='primary' icon={profile ? <EditOutlined /> : <PlusOutlined />} onClick={() => setDialog(profile || {})}>{profile ? '查看连接设置' : '添加数据库连接'}</Button>{profile && <Button onClick={() => connectProfile(profile)} loading={busy}>连接 {profile.title}</Button>}</div>
          : (
            <MysqlObjectBrowser tabId={tab.id} treeData={treeData} schema={schema} selectedKey={table ? JSON.stringify(['table', schema, table]) : ''} busy={busy} search={treeSearch} onSearch={setTreeSearch} loadData={loadTreeDatabase} onSelect={selectTreeObject}>
              {(objectsVisible, toggleObjects) => (
                <main className='mysql-content'><div className='mysql-object-toolbar'><Button size='small' type='text' aria-label='切换数据库对象树' icon={objectsVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={toggleObjects} /><Select size='small' showSearch aria-label='选择数据库' disabled={busy} value={schema || undefined} placeholder='选择数据库' options={databases.map(name => ({ value: name, label: name }))} onChange={name => perform(async () => { setSchema(name); setTable(''); setResult(null); await loadTables(name) })} /><Select size='small' showSearch aria-label='选择数据表' disabled={busy} value={table || undefined} placeholder='选择表' options={(tables[schema] || []).map(item => ({ value: item.name, label: item.name }))} onChange={item => openTable(schema, item)} /><Tooltip title='刷新数据库和表'><Button size='small' type='text' aria-label='刷新数据库' icon={<ReloadOutlined />} disabled={busy} onClick={refresh} /></Tooltip><Tooltip title='生成建表 SQL'><Button size='small' type='text' aria-label='新建数据表' icon={<PlusOutlined />} disabled={!schema || busy} onClick={newTable} /></Tooltip></div><Spin spinning={busy && activeTab !== 'sql'} className='mysql-content-spin'><Tabs className='mysql-main-tabs' size='small' activeKey={activeTab} onChange={setActiveTab} items={[{ key: 'data', label: '数据', children: dataView }, { key: 'structure', label: '结构', children: structureView }, { key: 'sql', label: 'SQL 查询', children: sqlView }]} /></Spin></main>
              )}
            </MysqlObjectBrowser>
            )}
        <footer className='mysql-status'><span className={connected ? 'connected' : ''}>● {connected ? server?.mode === 'ssh' ? 'SSH 隧道' : '直连' : '未连接'}</span><span>{server?.version || (profilesLoaded ? '已保存 ' + available.length + ' 个连接' : '正在读取配置')}</span></footer>
      </div>
      <DatabaseConnectionDialog open={Boolean(dialog) && expanded && active} profile={dialog} busy={busy} sshAvailable={Boolean(tab.host && tab.status === 'success')} onCancel={() => setDialog(null)} onSave={saveConnection} onDelete={deleteConnection} />
      <Modal title={record?.kind === 'insert' ? '新增记录' : '编辑记录'} open={Boolean(record) && expanded && active} width={620} onCancel={() => setRecord(null)} onOk={saveRecord} confirmLoading={busy} okText='提交到数据库' cancelText='取消'>
        <div className='mysql-record-fields'>{record && meta?.columns.map((column, index) => <div className='mysql-record-field' key={column.name}><label title={column.comment}>{column.name}<small>{column.type}{column.generated ? ' · 生成列' : ''}</small></label><Select size='small' value={record.modes[column.name]} disabled={column.generated} options={[{ value: 'value', label: '值' }, { value: 'null', label: 'NULL', disabled: !column.nullable }, ...(record.kind === 'insert' ? [{ value: 'default', label: '默认' }] : [])]} onChange={mode => setRecord(previous => ({ ...previous, modes: { ...previous.modes, [column.name]: mode } }))} /><Input.TextArea id={`mysql-field-${tab.id}-${index}`} rows={1} disabled={column.generated || record.modes[column.name] !== 'value' || record.values[column.name]?.kind === 'binary'} value={record.values[column.name]?.kind ? cellText(record.values[column.name]) : record.values[column.name] ?? ''} onChange={event => setRecord(previous => ({ ...previous, values: { ...previous.values, [column.name]: event.target.value } }))} /></div>)}</div>{error && <Alert type='error' message={error} />}
      </Modal>
      <Modal title={cell?.name || '字段内容'} open={Boolean(cell) && expanded && active} onCancel={() => setCell(null)} width={640} footer={<><Button onClick={() => window.pre.writeClipboard(cell?.value?.kind === 'binary' ? cell.value.base64 : cellText(cell?.value))} icon={<CopyOutlined />}>复制</Button><Button onClick={() => setCell(null)}>关闭</Button></>}><Input.TextArea className='mysql-cell-value' readOnly rows={12} value={cell?.value?.kind === 'binary' ? cell.value.base64 : cellText(cell?.value)} /></Modal>
      <Modal title='保存 SQL 查询' open={snippetDialog && expanded && active} onCancel={() => setSnippetDialog(false)} onOk={saveSnippet} okText='保存' cancelText='取消'><Input aria-label='查询名称' value={snippetName} onChange={event => setSnippetName(event.target.value)} placeholder='查询名称' maxLength={80} /></Modal>
      <Modal title='最近的 SQL 查询' open={historyDialog && expanded && active} onCancel={() => setHistoryDialog(false)} footer={null} width={640}><div className='mysql-history'>{(profile?.history || []).map((item, index) => <button key={index} onClick={() => { setSql(item.sql); setHistoryDialog(false); setActiveTab('sql') }}><small>{new Date(item.time).toLocaleString()} · {item.elapsed} ms</small><pre>{item.sql}</pre></button>)}{!profile?.history?.length && <p>还没有查询历史</p>}</div></Modal>
    </section>
  )
}
