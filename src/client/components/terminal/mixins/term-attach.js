import { debounce } from 'lodash-es'
import message from '../../common/message'
import AttachAddon from '../attach-addon-custom.js'
import { isWin } from '../../../common/constants.js'
import { isUnsafeFilename } from '../../../common/file-drop-utils.js'
import { createCdCommand } from '../ssh-reload-state.js'

/**
 * Everything that writes to the session: the socket attach addon, encoding,
 * quick commands / batch input, and the automation trigger manager that runs
 * on incoming data.
 */
export const attachMixin = {
  async initAttachAddon () {
    this.attachAddon = new AttachAddon(
      this.term,
      this.socket,
      isWin && !this.isRemote()
    )
    this.attachAddon.decoder = new TextDecoder(
      this.encode || this.props.tab.encode || 'utf-8'
    )
    await this.attachAddon.activate(this.term)
    if (this.osc52Addon) {
      this.osc52Addon.setSendData(this.attachAddon._sendData.bind(this.attachAddon))
    }
  },

  switchEncoding (encode) {
    this.encode = encode
    this.attachAddon.decoder = new TextDecoder(encode)
  },

  toggleKeepalive () {
    if (!this.attachAddon) {
      return false
    }
    this._keepaliveEnabled = !this._keepaliveEnabled
    this.attachAddon.setKeepalive(this._keepaliveEnabled)
    return this._keepaliveEnabled
  },

  batchInput (cmd) {
    this.attachAddon._sendData(cmd + '\r')
  },

  runQuickCommand (cmd, inputOnly = false) {
    if (this.term && this.attachAddon) {
      this.attachAddon._sendData(cmd + (inputOnly ? '' : '\r'))
      this.term.focus()
    }
  },

  cd (p) {
    if (isUnsafeFilename(p)) {
      return message.error('File name contains unsafe characters')
    }
    // Same shell resolution the session used: the bookmark/profile override
    // first, then the global setting. `localShell` is what actually spawned.
    const cmd = createCdCommand(p, {
      remote: !!this.isRemote(),
      shell: this.localShell || this.props.tab.execWindows || this.props.config.execWindows
    })
    if (cmd) {
      this.runQuickCommand(cmd)
    }
  },

  // 个人版不启动自动化触发器。
  refreshTriggers () {},

  // 没有触发器资源需要释放。
  disposeTriggerManager () {},

  // Called by attach-addon-custom once per flushed write, so the tab badge
  // updates without one notification per network chunk.
  notifyOnData () {
    if (!this._notifyOnDataDebounced) {
      this._notifyOnDataDebounced = debounce(() => {
        window.store.notifyTabOnData(this.props.tab.id)
      }, 1000)
    }
    this._notifyOnDataDebounced()
  }
}
