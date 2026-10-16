const { before, afterEach, test } = require('node:test')
const assert = require('node:assert/strict')

let model

// 使用真实状态注册逻辑，验证切换区域和关闭标签时的缓存生命周期。
before(async () => { model = await import('../../client/common/workspace-state.js') })
afterEach(() => model.pruneWorkspaceState([]))

// 同一服务器的多个标签不能共用数据库草稿或目录尺寸对象。
test('workspace seeds are independent between tabs and from the original snapshot', () => {
  const snapshot = { mysql: { sql: 'SELECT 1' }, files: { remotePath: '/home/qa' } }
  model.seedWorkspaceState('a', snapshot)
  model.seedWorkspaceState('b', snapshot)
  model.getWorkspaceState('a', 'mysql').sql = 'SELECT 2'
  assert.equal(model.getWorkspaceState('b', 'mysql').sql, 'SELECT 1')
  assert.equal(snapshot.mysql.sql, 'SELECT 1')
})

// 隐藏区域卸载仍保存最后内容；重新挂载后读取新状态。
test('unmounted workspace regions retain their last state', () => {
  model.seedWorkspaceState('a', { mysql: { sql: 'old' } })
  let path = '/home/qa'
  const remove = model.registerWorkspaceState('a', 'files', () => ({ path }))
  path = '/home/qa/plugins'
  assert.deepEqual(model.captureWorkspaceState('a'), { mysql: { sql: 'old' }, files: { path } })
  remove()
  assert.equal(model.getWorkspaceState('a', 'files').path, '/home/qa/plugins')
})

// 删除标签立即移除读取器，迟到的卸载回调不会重新插入已删除标签。
test('pruning closed tabs releases readers and does not resurrect their cache', () => {
  let reads = 0
  const remove = model.registerWorkspaceState('closed', 'mysql', () => { reads++; return { sql: 'large' } })
  model.seedWorkspaceState('kept', { files: { path: '/home' } })
  model.pruneWorkspaceState(['kept'])
  remove()
  assert.deepEqual(model.captureWorkspaceState('closed'), {})
  assert.equal(reads, 0)
  assert.equal(model.getWorkspaceState('kept', 'files').path, '/home')
})

// 区域重新注册后，旧组件卸载不能删除新组件的读取器。
test('old region cleanup does not overwrite a replacement reader', () => {
  const removeOld = model.registerWorkspaceState('a', 'mysql', () => ({ sql: 'old' }))
  const removeNew = model.registerWorkspaceState('a', 'mysql', () => ({ sql: 'new' }))
  removeOld()
  assert.equal(model.captureWorkspaceState('a').mysql.sql, 'new')
  removeNew()
  assert.equal(model.getWorkspaceState('a', 'mysql').sql, 'new')
})
