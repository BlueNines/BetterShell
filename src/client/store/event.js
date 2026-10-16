/**
 * extend store
 */

import { refs } from '../components/common/ref'

export default Store => {
  // 自动聚焦保留表单和文件浏览焦点，避免把目录定位字母发到终端。
  Store.prototype.focus = function () {
    window.focused = true
    if (window.store.onOperation) return
    const active = document.activeElement
    if (active?.closest('.personal-files')) return
    if (active?.matches('input, textarea, [contenteditable="true"]') && !active.closest('.xterm')) return
    refs.get('term-' + window.store.activeTabId)?.term?.focus()
  }

  Store.prototype.blur = function () {
    window.focused = false
    if (window.store.shouldSendWindowMove) {
      window.pre.runSync('windowMove', false)
    }
    refs.get('term-' + window.store.activeTabId)?.term?.blur()
  }

  Store.prototype.onBlur = function () {
    window.focused = false
    if (window.store.shouldSendWindowMove) {
      window.pre.runSync('windowMove', false)
    }
  }

  Store.prototype.selectall = function () {
    document.activeElement &&
    document.activeElement.select &&
    document.activeElement.select()
    refs.get('term-' + window.store.activeTabId)?.term?.selectAll()
  }

  Store.prototype.triggerResize = function () {
    window.store.resizeTrigger = window.store.resizeTrigger ? 0 : 1
    window.dispatchEvent(new Event('resize'))
  }

  Store.prototype.toggleSessFullscreen = function (fullscreen) {
    window.store.fullscreen = fullscreen
    setTimeout(window.store.triggerResize, 500)
  }
}
