import { throttle } from 'lodash-es'
import { resizeTerm } from '../terminal-apis.js'
import { minTerminalFontSize } from '../../../common/constants.js'
import { fitTerminalWithHistory } from '../terminal-history.js'

/**
 * Sizing: fitting the terminal into its (possibly hidden) container, font
 * zoom, and keeping the remote pty in sync with the on-screen size.
 */
export const resizeMixin = {
  // 判断终端挂载容器当前是否真实可见（非 display:none）。
  // 隐藏标签的 clientWidth/clientHeight 为 0，此时不应 fit，否则会算出 0 列。
  isElementVisible () {
    const el = this.domRef.current
    if (!el) {
      return false
    }
    return el.clientWidth > 0 && el.clientHeight > 0
  },

  // 重新适配终端尺寸并强制重绘可见区域。
  // 仅当容器真正可见时才 fit：隐藏标签(display:none)下 clientWidth 为 0，
  // 若在此时 fit 会算出 0/极小列数，使 shell 提示符被逐字符错误换行，
  // 出现快速连续打开多个连接时的虚假/重复提示符。因此隐藏态跳过 fit，
  // 保留 xterm 默认 80x24，待标签激活可见后再 fit 重绘，从根上避免换行损坏。
  fitAndRefresh (force = false) {
    if (!this.term || !this.fitAddon || this.onClose) {
      return
    }
    if (this.popout?.ready) {
      this.popout.resize(force)
      return
    }
    if (!this.isElementVisible()) {
      return
    }
    try {
      fitTerminalWithHistory(this.term, () => this.fitAddon.fit())
      this.term.refresh(0, this.term.rows - 1)
      this.onResizeTerminal({ cols: this.term.cols, rows: this.term.rows }, force)
    } catch (e) {
      console.info('resize failed', e)
    }
  },

  // One throttled runner per terminal: a module level one would let tabs
  // throttle each other.
  onResize () {
    if (!this._resizeThrottled) {
      this._resizeThrottled = throttle(() => this.fitAndRefresh(), 200)
    }
    this._resizeThrottled()
  },

  // 同一尺寸只发一次；显示位置切换时强制确认服务端收到当前行列数。
  onResizeTerminal (size, force = false) {
    const { cols, rows } = size
    if (!this.pid || this.onClose || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return
    const key = `${this.pid}:${cols}:${rows}`
    if (!force && this.lastPtySize === key) return
    this.lastPtySize = key
    return resizeTerm(this.pid, cols, rows).catch(error => {
      if (this.lastPtySize === key) this.lastPtySize = ''
      if (!this.onClose) console.info('terminal resize failed', error.message)
    })
  },

  zoom (v) {
    const { term } = this
    if (!term) {
      return
    }
    const next = Math.max(
      minTerminalFontSize,
      term.options.fontSize + v
    )
    const changed = next - term.options.fontSize
    if (changed === 0) {
      return
    }
    term.options.fontSize = next
    window.store.triggerResize()
    if (this.originalFontSize == null) {
      this.originalFontSize = next - changed
    }
    this.setState({
      fontSizeChanged: next !== this.originalFontSize
    })
  },

  handleResetFontSize () {
    const { term } = this
    if (!term || this.originalFontSize == null) {
      return
    }
    term.options.fontSize = this.originalFontSize
    window.store.triggerResize()
    this.setState({ fontSizeChanged: false })
    term.focus()
  }
}
