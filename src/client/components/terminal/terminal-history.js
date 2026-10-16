export const DEFAULT_TERMINAL_SCROLLBACK = 3000
const MAX_TERMINAL_SCROLLBACK = 20000

// 个人版始终保留有界历史，避免旧设置为零时完全不能回看。
export function terminalScrollback (value) {
  const lines = Number(value)
  return Number.isFinite(lines) && lines >= 1 ? Math.min(MAX_TERMINAL_SCROLLBACK, Math.trunc(lines)) : DEFAULT_TERMINAL_SCROLLBACK
}

// 备用屏幕也保留有界历史，覆盖普通 Shell 中手动附着 screen 的路径。
export function enableAlternateScrollback (terminal) {
  const alternate = terminal._core?.buffers?.alt
  if (!alternate || typeof alternate._hasScrollback !== 'boolean' || alternate._hasScrollback) return
  alternate._hasScrollback = true
  alternate.resize(terminal.cols, terminal.rows)
}

// 适配尺寸时锚定正在回看的行，避免窗口变矮后历史视图被向下推移。
export function fitTerminalWithHistory (terminal, fit) {
  const buffer = terminal.buffer.active
  const marker = buffer.viewportY < buffer.baseY ? terminal.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY) : null
  try {
    fit()
    if (marker && !marker.isDisposed) terminal.scrollToLine(marker.line)
  } finally { marker?.dispose() }
}

// 普通滑轮用于本地回看，Alt 保留终端原有的鼠标协议处理。
export function setupTerminalHistory (terminal) {
  let remaining = 0
  const element = terminal.element
  const buffers = terminal.buffer.onBufferChange(() => enableAlternateScrollback(terminal))
  enableAlternateScrollback(terminal)

  // screen 常用删除行或向上卷屏重绘，把移出顶部的行纳入历史而非直接销毁。
  function scrollOut (params, deleting) {
    const core = terminal._core
    const service = core?._bufferService
    const buffer = service?.buffer
    const input = core?._inputHandler
    if (terminal.buffer.active.type !== 'alternate' || !buffer?.hasScrollback || buffer.scrollTop !== 0 || (deleting && buffer.y !== 0) || typeof input?._eraseAttrData !== 'function') return false
    if (Array.isArray(params[0])) return false
    const count = Math.min(buffer.scrollBottom + 1, Math.max(1, Number(params[0]) || 1))
    for (let index = 0; index < count; index++) service.scroll(input._eraseAttrData())
    if (deleting) buffer.x = 0
    input._dirtyRowTracker.markRangeDirty(0, buffer.scrollBottom)
    return true
  }

  const handlers = [
    terminal.parser.registerCsiHandler({ final: 'M' }, params => scrollOut(params, true)),
    terminal.parser.registerCsiHandler({ final: 'S' }, params => scrollOut(params, false))
  ]

  // 在捕获阶段拦截 screen 滚动，不把回看历史误转成方向键或鼠标命令。
  function wheel (event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !event.deltaY) return
    const height = terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height / terminal.rows
    if (!(height > 0)) return
    const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * terminal.rows : event.deltaY / height
    remaining += delta
    const lines = Math.trunc(remaining)
    remaining -= lines
    event.preventDefault()
    event.stopPropagation()
    if (lines) terminal.scrollLines(lines)
  }

  element?.addEventListener('wheel', wheel, { capture: true, passive: false })
  return {
    // 终端或独立视图销毁时释放事件，不保留隐藏窗口引用。
    dispose () {
      buffers.dispose()
      handlers.forEach(handler => handler.dispose())
      element?.removeEventListener('wheel', wheel, true)
    }
  }
}
