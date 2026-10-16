const { before, test } = require('node:test')
const assert = require('node:assert/strict')

let model

// 加载实际用于恢复连接列表和默认选择的规则。
before(async () => { model = await import('../../client/components/mysql/profiles.js') })

// 新标签、重连和历史入口必须使用同一服务器身份。
test('MySQL profile ownership is stable across recreated shell tabs', () => {
  const bookmarks = [{ id: 'bookmark-a', host: 'Server.EXAMPLE', port: 22, username: 'qa' }]
  assert.equal(model.databaseOwner({ srcId: 'bookmark-a', id: 'random-a' }, bookmarks), 'bookmark-a')
  assert.equal(model.databaseOwner({ host: 'server.example', username: 'qa', id: 'random-b' }, bookmarks), 'bookmark-a')
  assert.equal(model.databaseOwner({ type: 'local', id: 'random-c' }), 'local')
  assert.equal(model.databaseOwner({ host: 'other.example', username: 'qa', id: 'random-a' }), model.databaseOwner({ host: 'other.example', username: 'qa', id: 'random-b' }))
})

// 当前服务器默认恢复上次选择，同时兼容已经保存的旧版配置。
test('MySQL default profile restores the last selection without mixing server owners', () => {
  const profiles = [
    { id: 'legacy', mode: 'direct' },
    { id: 'ssh-a', mode: 'ssh', sshBookmarkId: 'bookmark-a', lastSelectedAt: 5 },
    { id: 'direct-a', mode: 'direct', shellBookmarkId: 'bookmark-a', lastSelectedAt: 10 },
    { id: 'ssh-b', mode: 'ssh', shellBookmarkId: 'bookmark-b', lastSelectedAt: 20 }
  ]
  const available = model.availableDatabaseProfiles(profiles, 'bookmark-a')
  assert.deepEqual(available.map(item => item.id), ['legacy', 'ssh-a', 'direct-a'])
  assert.equal(model.defaultDatabaseProfile(available).id, 'direct-a')
  assert.equal(model.defaultDatabaseProfile([{ id: 'old-profile' }]).id, 'old-profile')
  assert.equal(model.defaultDatabaseProfile([]), null)
})
