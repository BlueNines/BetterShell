const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 隔离 HTTP 依赖，测试真实尺寸同步方法是否发送正确参数和释放失败缓存。
function model (request = () => Promise.resolve()) {
  const calls = []
  const source = fs.readFileSync(path.resolve(__dirname, '../../client/components/terminal/mixins/term-resize.js'), 'utf8').replace(/^import[^\r\n]*\r?\n/gm, '').replace('export const resizeMixin =', 'module.exports =')
  const sandbox = { module: { exports: {} }, console: { info () {} }, resizeTerm (...args) { calls.push(args); return request(...args) } }
  vm.runInNewContext(source, sandbox)
  const host = { pid: 'screen-qa', onClose: false, lastPtySize: '' }
  host.onResizeTerminal = sandbox.module.exports.onResizeTerminal
  return { host, calls }
}

// 连续相同尺寸不重复请求，弹出或合回可显式确认同一尺寸。
test('terminal dimensions deduplicate ordinary refreshes and allow explicit confirmation', async () => {
  const { host, calls } = model()
  await host.onResizeTerminal({ cols: 120, rows: 40 })
  await host.onResizeTerminal({ cols: 120, rows: 40 })
  await host.onResizeTerminal({ cols: 120, rows: 40 }, true)
  await host.onResizeTerminal({ cols: 90, rows: 30 })
  assert.deepEqual(calls, [['screen-qa', 120, 40], ['screen-qa', 120, 40], ['screen-qa', 90, 30]])
})

// 已关闭、未连接和无效列数不能发送尺寸请求。
test('closed or uninitialized terminals never send invalid sizes', async () => {
  const { host, calls } = model()
  host.pid = undefined
  await host.onResizeTerminal({ cols: 80, rows: 24 }, true)
  host.pid = 'screen-qa'
  host.onClose = true
  await host.onResizeTerminal({ cols: 80, rows: 24 }, true)
  host.onClose = false
  for (const size of [{ cols: 0, rows: 24 }, { cols: 80, rows: 0 }, { cols: NaN, rows: 24 }]) await host.onResizeTerminal(size)
  assert.deepEqual(calls, [])
})

// 失败后仍能重试同一尺寸，不让旧缓存永久阻断正确的 PTY 更新。
test('a failed resize can be retried with the same dimensions', async () => {
  let fail = true
  const { host, calls } = model(() => fail ? Promise.reject(new Error('fixture unavailable')) : Promise.resolve())
  await host.onResizeTerminal({ cols: 120, rows: 40 })
  fail = false
  await host.onResizeTerminal({ cols: 120, rows: 40 })
  assert.equal(calls.length, 2)
})
