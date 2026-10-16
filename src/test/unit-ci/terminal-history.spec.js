const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Terminal } = require('@xterm/headless')

// 等待真实终端完成解析，不能只用字符串长度判断缓存是否保留。
function write (terminal, text) { return new Promise(resolve => terminal.write(text, resolve)) }

// 老配置的零值和无效值必须恢复默认，极大值需要受到内存上限约束。
test('terminal history is enabled by default and bounded', async () => {
  const { terminalScrollback } = await import('../../client/components/terminal/terminal-history.js')
  for (const value of [undefined, null, 0, -1, 'bad', Infinity]) assert.equal(terminalScrollback(value), 3000)
  assert.equal(terminalScrollback(4500), 4500)
  assert.equal(terminalScrollback(1000000), 20000)
})

// screen 保留备用屏幕切换语义，历史有界且不关闭括号粘贴等终端模式。
test('screen alternate buffer retains scrollback without disabling terminal modes', async () => {
  const { setupTerminalHistory } = await import('../../client/components/terminal/terminal-history.js')
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 5, scrollback: 20 })
  const history = setupTerminalHistory(terminal)
  try {
    await write(terminal, '\x1b[?1049h\x1b[?2004h' + Array.from({ length: 40 }, (_, index) => `history-${index}\r\n`).join(''))
    assert.equal(terminal.buffer.active.type, 'alternate')
    assert.ok(terminal.buffer.active.baseY > 0)
    assert.equal(terminal.buffer.active.length, 25)
    assert.equal(terminal.modes.bracketedPasteMode, true)
    terminal.scrollToTop()
    assert.equal(terminal.buffer.active.viewportY, 0)
    assert.match(terminal.buffer.active.getLine(0).translateToString(true), /history-/)
    await write(terminal, '\x1b[?1049l')
    assert.equal(terminal.buffer.active.type, 'normal')
    assert.equal(terminal.buffer.alternate.length, 0)
    terminal.reset()
    await write(terminal, '\x1b[?1049h' + 'reset-history\r\n'.repeat(15))
    assert.ok(terminal.buffer.active.baseY > 0)
  } finally { history.dispose(); terminal.dispose() }
})

// 普通 Shell 手动进入 screen 后仍要有历史，退出时恢复原来的普通缓冲区。
test('manually attached alternate screens retain history in ordinary shells', async () => {
  const { setupTerminalHistory } = await import('../../client/components/terminal/terminal-history.js')
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 5, scrollback: 20 })
  const history = setupTerminalHistory(terminal)
  try {
    await write(terminal, 'ordinary-history\r\n'.repeat(15))
    assert.ok(terminal.buffer.active.baseY > 0)
    await write(terminal, '\x1b[?1049h' + 'fullscreen\r\n'.repeat(15))
    assert.ok(terminal.buffer.active.baseY > 0)
    assert.equal(terminal.buffer.active.type, 'alternate')
    await write(terminal, '\x1b[?1049l')
    assert.equal(terminal.buffer.active.type, 'normal')
    assert.match(terminal.buffer.active.getLine(0).translateToString(true), /ordinary-history/)
  } finally { history.dispose(); terminal.dispose() }
})

// 真实 screen 的删除行/卷屏不能丢历史，也不能改变当前屏幕和固定状态栏。
test('delete-line and scroll-up repaint retain history with identical live contents', async () => {
  const { setupTerminalHistory } = await import('../../client/components/terminal/terminal-history.js')
  for (const sequence of ['\x1b[H\x1b[M', '\x1b[S']) {
    const options = { allowProposedApi: true, cols: 30, rows: 6, scrollback: 20 }
    const terminal = new Terminal(options)
    const reference = new Terminal(options)
    const history = setupTerminalHistory(terminal)
    try {
      const initial = '\x1b[?1049h' + Array.from({ length: 6 }, (_, index) => `\x1b[${index + 1};1Hline-${index}`).join('') + '\x1b[1;5r'
      await write(terminal, initial)
      await write(reference, initial)
      for (let index = 0; index < 15; index++) {
        const frame = sequence + `\x1b[5;1Hnew-${index}\x1b[K`
        await write(terminal, frame)
        await write(reference, frame)
        const visible = target => Array.from({ length: target.rows }, (_, row) => target.buffer.active.getLine(target.buffer.active.baseY + row).translateToString(true))
        assert.deepEqual(visible(terminal), visible(reference))
      }
      assert.ok(terminal.buffer.active.baseY > 0)
      assert.match(terminal.buffer.active.getLine(0).translateToString(true), /line-0/)
    } finally { history.dispose(); terminal.dispose(); reference.dispose() }
  }
})

// 改变行数时保留回看锚点，并立即释放临时 marker，避免每次缩放累积引用。
test('resizing keeps the history line and releases its marker', async () => {
  const { fitTerminalWithHistory, setupTerminalHistory } = await import('../../client/components/terminal/terminal-history.js')
  for (const screen of [false, true]) {
    const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 8, scrollback: 20 })
    const history = setupTerminalHistory(terminal)
    try {
      await write(terminal, (screen ? '\x1b[?1049h' : '') + 'resize-history\r\n'.repeat(18))
      terminal.scrollToLine(2)
      const markers = terminal.markers.length
      fitTerminalWithHistory(terminal, () => terminal.resize(40, 5))
      assert.equal(terminal.buffer.active.viewportY, 2)
      assert.equal(terminal.markers.length, markers)
    } finally { history.dispose(); terminal.dispose() }
  }
})
