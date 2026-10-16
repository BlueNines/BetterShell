const { TerminalBase } = require('./session-base')
const { screenAttachCommand } = require('../common/screen-sessions.mjs')
const globalState = require('./global-state')

// 只拥有当前 screen 的 PTY 通道，不能结束父 Shell 的 SSH 连接。
class ScreenTerminal extends TerminalBase {
  // 复用父标签的认证连接，不再次读取密码或建立 SSH 网络连接。
  async init () {
    const parent = globalState.getSession(this.initOptions.screenParentId)
    if (!parent?.conn || parent.isScreen) throw new Error('对应 SSH 控制台尚未连接')
    this.isScreen = true
    const { screenSession, rows, cols, term } = this.initOptions
    const command = screenAttachCommand(screenSession)
    await new Promise((resolve, reject) => {
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; reject(new Error('screen 通道打开超时')) }, 15000)
      parent.conn.exec(command, { pty: { rows: rows || 24, cols: cols || 80, term: term || 'xterm-256color' } }, (error, channel) => {
        clearTimeout(timer)
        if (timedOut) { channel?.close(); return }
        if (error) { reject(error); return }
        this.channel = channel
        globalState.setSession(this.pid, this)
        resolve()
      })
    })
    return this
  }

  // 保留终端输入，包括 Ctrl+A 等 screen 快捷键。
  write (data) { this.channel?.write(data) }

  // 独立窗口和内嵌视图的实际尺寸同步到同一个远程 PTY。
  resize (cols, rows) { this.channel?.setWindow(rows, cols) }

  // 终端输出和错误输出沿用现有流式显示入口。
  on (event, handler) { this.channel?.on(event, handler); this.channel?.stderr.on(event, handler) }

  // 关闭观看通道前移除对应监听，防止重复输出和回调泄漏。
  off (event, handler) { this.channel?.removeListener(event, handler); this.channel?.stderr.removeListener(event, handler) }

  // 关闭通道只解除当前观看连接，服务端 screen 内的程序继续运行。
  kill () {
    if (this.closed) return
    this.closed = true
    this.channel?.close()
    this.channel = null
    this.sessionLogger?.destroy()
    this._vtTerm?.dispose()
    if (globalState.getSession(this.pid) === this) globalState.removeSession(this.pid)
    if (process.connected) process.send({ terminalClosed: this.pid })
  }
}

// 新建前释放同一标识的旧通道，重连不会叠加 screen 观看连接。
exports.session = async function (options, ws) {
  globalState.getSession(options.uid)?.isScreen && globalState.getSession(options.uid).kill()
  return new ScreenTerminal(options, ws).init()
}
