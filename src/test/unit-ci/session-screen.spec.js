const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const globalState = require('../../app/server/global-state')
const { session } = require('../../app/server/session-screen')

// 模拟独立 PTY 通道，验证关闭观看连接绝不能结束父 SSH。
test('screen session owns only its channel and keeps the parent ssh alive', async () => {
  const channel = new EventEmitter()
  channel.stderr = new EventEmitter()
  const writes = []
  const sizes = []
  let closed = 0
  let parentEnded = 0
  channel.write = data => writes.push(data)
  channel.setWindow = (rows, cols) => sizes.push([rows, cols])
  channel.close = () => { closed++ }
  globalState.setSession('screen-parent-qa', { conn: { end: () => { parentEnded++ }, exec: (command, options, callback) => { assert.equal(command, "exec screen -A -x '1234.main'"); assert.equal(options.pty.cols, 100); callback(null, channel) } } })
  const terminal = await session({ uid: 'screen-child-qa', screenParentId: 'screen-parent-qa', screenSession: '1234.main', cols: 100, rows: 30 })
  terminal.write('中文命令\r')
  terminal.resize(120, 40)
  assert.deepEqual(writes, ['中文命令\r'])
  assert.deepEqual(sizes, [[40, 120]])
  let count = 0
  const handler = () => { count++ }
  terminal.on('data', handler)
  channel.emit('data', 'output')
  terminal.off('data', handler)
  channel.emit('data', 'ignored')
  assert.equal(count, 1)
  terminal.kill()
  terminal.kill()
  assert.equal(closed, 1)
  assert.equal(parentEnded, 0)
  assert.equal(globalState.getSession('screen-child-qa'), undefined)
  assert.ok(globalState.getSession('screen-parent-qa'))
  globalState.removeSession('screen-parent-qa')
})

// 父服务器不可用时明确失败，不能隐式创建新的 SSH 或 screen 会话。
test('screen requires its existing parent connection', async () => {
  await assert.rejects(session({ uid: 'screen-child-absent', screenParentId: 'absent', screenSession: '1234.main' }), /尚未连接/)
})
