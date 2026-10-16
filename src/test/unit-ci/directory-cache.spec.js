const { test } = require('node:test')
const assert = require('node:assert/strict')

// 可控时钟验证新鲜快照复用、陈旧快照立即可见和后台重新读取。
test('directory snapshots avoid fresh reads and expire within a bounded time', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  let now = 0
  let calls = 0
  const cache = new Cache(async () => [{ name: String(++calls) }], { now: () => now })
  const first = await cache.read('/a')
  assert.equal(await cache.read('/a'), first)
  assert.equal(calls, 1)
  now = 6000
  assert.equal(cache.peek('/a').list, first)
  assert.notEqual(await cache.read('/a'), first)
  now = 40000
  assert.equal(cache.peek('/a'), null)
  assert.equal(cache.files, 0)
  assert.equal(cache.bytes, 0)
})

// 树、文件列表和预读同时请求同一路径时只应发出一次实际读取。
test('concurrent directory consumers share one read', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  let complete
  let calls = 0
  const cache = new Cache(() => { calls++; return new Promise(resolve => { complete = resolve }) })
  const first = cache.read('/a')
  const second = cache.read('/a')
  await Promise.resolve()
  assert.equal(calls, 1)
  complete([{ name: 'fresh' }])
  assert.equal(await first, await second)
  cache.dispose()
})

// 删除或改名后的旧响应不能复活失效目录，也不能覆盖随后发起的新读取。
test('invalidation rejects late cache writes without disturbing the replacement read', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  const completions = []
  const cache = new Cache(() => new Promise(resolve => completions.push(resolve)))
  const old = cache.read('/a')
  await Promise.resolve()
  cache.invalidate('/a')
  const fresh = cache.read('/a')
  await Promise.resolve()
  completions[1]([{ name: 'new' }])
  await fresh
  completions[0]([{ name: 'deleted' }])
  await old
  assert.equal(cache.peek('/a').list[0].name, 'new')
  cache.dispose()
})

// 路径失效只影响自身和真正的子路径，不能误伤同名前缀的邻居。
test('directory invalidation covers descendants on POSIX and Windows paths', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  for (const [parent, child, sibling] of [['/a', '/a/b', '/ab'], ['C:\\a', 'C:\\a\\b', 'C:\\ab']]) {
    const cache = new Cache(async () => [])
    await Promise.all([parent, child, sibling].map(folder => cache.read(folder)))
    cache.invalidate(parent)
    assert.equal(cache.peek(parent), null)
    assert.equal(cache.peek(child), null)
    assert.ok(cache.peek(sibling))
  }
})

// 反复浏览时限制目录和条目预算，并优先淘汰最久未用项；超大目录不缓存。
test('directory memory budgets evict least recently used results and reject oversized lists', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  const cache = new Cache(async folder => Array.from({ length: folder === '/large' ? 4 : 1 }, () => ({ name: folder })), { maxDirectories: 2, maxFiles: 2, maxBytes: 1000 })
  await cache.read('/a')
  await cache.read('/b')
  cache.peek('/a')
  await cache.read('/c')
  assert.equal(cache.peek('/b'), null)
  assert.ok(cache.peek('/a'))
  assert.equal((await cache.read('/large')).length, 4)
  assert.equal(cache.peek('/large'), null)
  assert.ok(cache.files <= 2 && cache.bytes <= 1000)
  const tiny = new Cache(async () => [{ name: 'x'.repeat(1000) }], { maxBytes: 512 })
  await tiny.read('/large-name')
  assert.equal(tiny.entries.size, 0)
})

// 读取失败可以重试，卸载后请求完成也不能持有目录数据。
test('failed reads retry and disposal releases snapshots and pending ownership', async () => {
  const { default: Cache } = await import('../../client/common/directory-cache.js')
  let fail = true
  const cache = new Cache(async () => { if (fail) throw new Error('permission'); return [] })
  await assert.rejects(cache.read('/a'), /permission/)
  fail = false
  await cache.read('/a')
  cache.dispose()
  assert.equal(cache.entries.size, 0)
  assert.equal(cache.pending.size, 0)
  await assert.rejects(cache.read('/a'), /关闭/)
  let complete
  const closing = new Cache(() => new Promise(resolve => { complete = resolve }))
  const pending = closing.read('/late')
  await Promise.resolve()
  closing.dispose()
  complete([{ name: 'late' }])
  await pending
  assert.equal(closing.entries.size, 0)
})
