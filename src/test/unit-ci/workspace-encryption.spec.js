const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createDb } = require('../../app/lib/sqlite')

// 为数据库适配层创建隔离目录，不读写真实用户连接。
function isolatedDb (crypto) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bettershell-workspace-'))
  const previous = process.env.DATA_PATH
  process.env.DATA_PATH = directory
  try { return { directory, ...createDb(directory, 'qa', crypto) } } finally {
    if (previous === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = previous
  }
}

// 工作区内的临时密码、SQL 和终端文本不能回退到明文或旧加密格式。
test('workspace refuses persistence when Windows safe encryption is unavailable', async () => {
  for (const crypto of [undefined, { enc: value => Buffer.from(value).toString('base64') }]) {
    const db = isolatedDb(crypto)
    await assert.rejects(db.dbAction('personalWorkspace', 'insert', { _id: 'lastWorkspace', snapshot: { version: 1, tabs: [] } }), /系统加密不可用/)
    assert.equal(await db.dbAction('personalWorkspace', 'findOne', { _id: 'lastWorkspace' }), null)
  }
})

// 用可逆测试编码检查强制安全格式、覆盖同一快照和完整 UTF-8 读取。
test('workspace replaces one encrypted snapshot and restores Chinese content', async () => {
  const db = isolatedDb({ enc: value => 'v2:safe:' + Buffer.from(value, 'utf8').toString('base64'), dec: value => Buffer.from(value.slice('v2:safe:'.length), 'base64').toString('utf8') })
  const snapshot = { version: 1, tabs: [{ connection: { title: '服务器', password: 'fixture-only' }, state: { files: { remotePath: '/home/测试' } } }], activeIndex: 0 }
  await db.dbAction('personalWorkspace', 'insert', { _id: 'lastWorkspace', snapshot })
  assert.deepEqual((await db.dbAction('personalWorkspace', 'findOne', { _id: 'lastWorkspace' })).snapshot, snapshot)
  const disk = new DatabaseSync(path.join(db.directory, 'users/qa/electerm.db'), { readOnly: true })
  const row = disk.prepare('SELECT data FROM personalWorkspace').get()
  assert.ok(row.data.startsWith('enc:v2:safe:'))
  assert.equal(row.data.includes('fixture-only'), false)
  disk.close()
  await db.dbAction('personalWorkspace', 'insert', { _id: 'lastWorkspace', snapshot: { version: 1, tabs: [], activeIndex: 0 } })
  assert.equal((await db.dbAction('personalWorkspace', 'find')).length, 1)
  assert.equal((await db.dbAction('personalWorkspace', 'findOne', { _id: 'lastWorkspace' })).snapshot.tabs.length, 0)
})
