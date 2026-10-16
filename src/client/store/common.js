/**
 * common functions
 */

import handleError from '../common/error-handler'
import Modal from '../components/common/modal'
import { debounce, some, get, pickBy } from 'lodash-es'
import {
  leftSidePanelWidthKey,
  leftSideBarOpenKey,
  rightSidebarWidthKey,
  rightPanelPinnedKey,
  cmdHistoryInRightPanelKey,
  quickCommandsInRightPanelKey,
  addPanelWidthLsKey,
  connectionMap,
  mobileBreakpoint,
  splitMap,
  settingAiId,
  settingSyncId
} from '../common/constants'
import * as ls from '../common/safe-local-storage'
import { refs, refsStatic } from '../components/common/ref'
import { requireTermOfUse } from '../common/term-of-use'
import { action } from 'manate'
import uid from '../common/uid'
import deepCopy from 'json-deep-copy'

const e = window.translate
const { assign } = Object

export default Store => {
  Store.prototype.storeAssign = function (updates) {
    assign(window.store, updates)
  }

  Store.prototype.onError = function (e) {
    handleError(e)
  }

  Store.prototype.updateConfig = function (ext) {
    window.store.setConfig(ext)
  }

  // The footer info icon is a toggle: the same click opens and closes the
  // panel, so the trigger never has to be hunted down in the panel header.
  Store.prototype.toggleInfoPanel = action(function () {
    const { store } = window
    const isOpen = store.rightPanelVisible && store.rightPanelTab === 'info'
    store.rightPanelVisible = !isOpen
    store.rightPanelTab = 'info'
    if (!isOpen) {
      store.openInfoPanelAction()
    }
  })

  Store.prototype.openInfoPanel = action(function () {
    const { store } = window
    store.rightPanelVisible = true
    store.rightPanelTab = 'info'
    store.openInfoPanelAction()
  })

  Store.prototype.openInfoPanelAction = function () {
    const { store } = window
    setTimeout(() => {
      const term = refs.get('term-' + store.activeTabId)
      term && term.handleShowInfo()
    }, 300)
  }

  Store.prototype.onResize = debounce(async function () {
    const { width, height } = await window.pre.runGlobalAsync('getScreenSize')
    const isMaximized = window.pre.runSync('isMaximized')
    const w = window.innerWidth
    const isMobile = w <= mobileBreakpoint
    const update = {
      height: window.innerHeight,
      innerWidth: w,
      screenWidth: width,
      screenHeight: height,
      isMaximized,
      isMobile
    }
    window.store.storeAssign(update)
    // Force single-column layout on mobile
    if (isMobile && window.store.layout !== splitMap.c1) {
      window.store.setLayout(splitMap.c1)
    }
    window.pre.runGlobalAsync('setWindowSize', {
      ...update,
      width: window.outerWidth,
      height: window.outerHeight
    })
  }, 100, {
    leading: true
  })

  Store.prototype.toggleTerminalSearch = function () {
    const now = Date.now()
    if (window.lastToggleTerminalSearch && now - window.lastToggleTerminalSearch < 300) {
      return
    }
    window.lastToggleTerminalSearch = now
    window.store.termSearchOpen = !window.store.termSearchOpen
  }

  Store.prototype.setState = function (name, value) {
    window.store['_' + name] = JSON.stringify(value)
  }

  Store.prototype.setSettingItem = function (v) {
    // entering the AI / sync setting page requires the term of use
    // confirmation first (when the term is defined)
    if (
      v && (
        v.id === settingAiId || v.id === settingSyncId
      )
    ) {
      const type = v.id === settingAiId ? 'ai' : 'sync'
      return requireTermOfUse(type, () => {
        window.store.settingItem = v
      })
    }
    window.store.settingItem = v
  }

  Store.prototype.setTermSearchOption = function (update) {
    Object.assign(window.store._termSearchOptions, update)
  }

  // Both panel widths are desktop-only preferences: on mobile the panel is a
  // full-width drawer whose width is fixed, so a drag (or any other caller)
  // must not overwrite the desktop value that is still in localStorage.
  Store.prototype.setLeftSidePanelWidth = function (v) {
    if (window.store.isMobile) {
      return
    }
    ls.setItem(leftSidePanelWidthKey, v)
    window.store._leftSidePanelWidth = v
  }

  Store.prototype.toggleLeftSideBar = function () {
    const { store } = window
    const willOpen = !store._leftSideBarOpen
    store._leftSideBarOpen = willOpen
    ls.setItem(leftSideBarOpenKey, willOpen ? 'true' : 'false')
    if (!willOpen) {
      // hiding the bar also closes/unpins the side panel so no space is reserved
      store.handleCloseSidebar()
    }
  }

  Store.prototype.setAddPanelWidth = function (v) {
    ls.setItem(addPanelWidthLsKey, v)
    window.store.addPanelWidth = v
  }

  Store.prototype.setRightSidePanelWidth = function (v) {
    if (window.store.isMobile) {
      return
    }
    ls.setItem(rightSidebarWidthKey, v)
    window.store._rightPanelWidth = v
  }

  // Persist the pin the same way the left sidebar does (sidebarPinnedKey):
  // pinned is a durable layout preference, not a per-session toggle. It matters
  // more here because pinned and unpinned are visibly different modes — the
  // unpinned panel is an overlay that clears the footer, the pinned one is a
  // full-height dock.
  Store.prototype.setRightPanelPinned = function (v) {
    ls.setItem(rightPanelPinnedKey, v + '')
    window.store.rightPanelPinned = v
  }

  // The cmd history panel has two homes: the footer popover (the default) and
  // the right side panel. Which one it is in is a durable preference, persisted
  // like the right panel pin — the footer trigger has to keep landing where the
  // user last put the panel, or the choice would only survive until the next
  // reload.
  Store.prototype.setCmdHistoryInRightPanel = function (v) {
    ls.setItem(cmdHistoryInRightPanelKey, v + '')
    window.store.cmdHistoryInRightPanel = v
  }

  Store.prototype.openCmdHistoryPanel = function () {
    const { store } = window
    store.rightPanelVisible = true
    store.rightPanelTab = 'cmdHistory'
  }

  // Same toggle contract as toggleInfoPanel/toggleAIPanel: while the history
  // lives in the right panel, the footer trigger opens and closes it.
  Store.prototype.toggleCmdHistoryPanel = function () {
    const { store } = window
    if (store.rightPanelVisible && store.rightPanelTab === 'cmdHistory') {
      store.rightPanelVisible = false
      return
    }
    store.openCmdHistoryPanel()
  }

  Store.prototype.moveCmdHistoryToRightPanel = function () {
    const { store } = window
    store.setCmdHistoryInRightPanel(true)
    store.openCmdHistoryPanel()
  }

  // Hand the panel back to the footer popover and open it there: the move has
  // to be visible, otherwise the panel just looks like it vanished.
  Store.prototype.moveCmdHistoryToFooter = function () {
    const { store } = window
    store.setCmdHistoryInRightPanel(false)
    if (store.rightPanelTab === 'cmdHistory') {
      store.rightPanelVisible = false
    }
    refsStatic.get('CmdHistory')?.openPopover()
  }

  // The quick command panel has the same two homes as the cmd history one, and
  // the same durable preference: the footer popup (the default) and the right
  // side panel. The footer popup is not a popover but a floating box driven by
  // store.openQuickCommandBar, so "docked" is expressed by the preference alone
  // and the box itself decides which of its two forms to render.
  Store.prototype.setQuickCommandsInRightPanel = function (v) {
    ls.setItem(quickCommandsInRightPanelKey, v + '')
    window.store.quickCommandsInRightPanel = v
  }

  Store.prototype.openQuickCommandsPanel = function () {
    const { store } = window
    store.rightPanelVisible = true
    store.rightPanelTab = 'quickCommands'
  }

  // Same toggle contract as toggleInfoPanel/toggleAIPanel/toggleCmdHistoryPanel:
  // while the panel lives in the right panel, the footer Q opens and closes it.
  Store.prototype.toggleQuickCommandsPanel = function () {
    const { store } = window
    if (store.rightPanelVisible && store.rightPanelTab === 'quickCommands') {
      store.rightPanelVisible = false
      return
    }
    store.openQuickCommandsPanel()
  }

  Store.prototype.moveQuickCommandsToRightPanel = function () {
    const { store } = window
    store.setQuickCommandsInRightPanel(true)
    // the footer box would otherwise be left floating over a terminal it no
    // longer owns; the pin is deliberately kept, so handing the panel back
    // restores the exact shape it had before
    store.openQuickCommandBar = false
    store.openQuickCommandsPanel()
  }

  // Hand the panel back to the footer and open it there: the move has to be
  // visible, otherwise the panel just looks like it vanished. A pin that was
  // left on while docked brings the box back pinned, which is what the user
  // last asked for.
  Store.prototype.moveQuickCommandsToFooter = function () {
    const { store } = window
    store.setQuickCommandsInRightPanel(false)
    if (store.rightPanelTab === 'quickCommands') {
      store.rightPanelVisible = false
    }
    store.openQuickCommandBar = true
  }
  Store.prototype.beforeExit = function (evt) {
    const { confirmBeforeExit } = window.store.config
    if (
      (confirmBeforeExit &&
      !window.confirmExit) ||
      window.store.isTransporting
    ) {
      evt.returnValue = false
      let mod = null
      mod = Modal.confirm({
        onCancel: () => {
          window.confirmExit = false
          mod.destroy()
        },
        onOk: () => {
          window.confirmExit = true
          window.store[window.exitFunction]()
        },
        title: e('quit'),
        okText: e('ok'),
        cancelText: e('cancel'),
        content: ''
      })
    }
  }
  Store.prototype.beforeExitApp = function (evt, name) {
    let mod = null
    mod = Modal.confirm({
      onCancel: () => {
        window.pre.runGlobalAsync('setCloseAction', 'closeApp')
        mod.destroy()
      },
      onOk: () => {
        window.pre.runGlobalAsync(name)
      },
      title: e('quit'),
      okText: e('ok'),
      cancelText: e('cancel'),
      content: ''
    })
  }

  Store.prototype.toggleResolutionEdit = function () {
    window.store.openResolutionEdit = !window.store.openResolutionEdit
  }

  Store.prototype.setTerminalInfos = function (arr) {
    window.store.setConfig({
      terminalInfos: arr
    })
  }

  Store.prototype.applyProfile = function (tab) {
    const {
      profile,
      type,
      authType
    } = tab
    // SSH picks auth type explicitly (password/privateKey/profiles radio),
    // other types only have the profile dropdown, so a selected profile
    // always means profile auth for them
    const useProfile = type === connectionMap.ssh
      ? authType === 'profiles'
      : true
    if (!profile || !useProfile) {
      return tab
    }
    let p = window.store.profiles.find(x => x.id === profile)
    if (!p) {
      return tab
    }
    p = deepCopy(p)
    // delete tab.password
    // delete tab.privateKey
    // delete tab.passphrase
    delete p.name
    delete p.id
    if (type === connectionMap.rdp) {
      const filtered = pickBy(p.rdp, (value) => value !== undefined && value !== '')
      return {
        ...tab,
        ...filtered
      }
    } else if (type === connectionMap.vnc) {
      const filtered = pickBy(p.vnc, (value) => value !== undefined && value !== '')
      return {
        ...tab,
        ...filtered
      }
    } else if (type === connectionMap.telnet) {
      const filtered = pickBy(p.telnet, (value) => value !== undefined && value !== '')
      return {
        ...tab,
        ...filtered
      }
    } else if (type === connectionMap.ftp) {
      const filtered = pickBy(p.ftp, (value) => value !== undefined && value !== '')
      return {
        ...tab,
        ...filtered
      }
    }
    delete p.rdp
    delete p.vnc
    delete p.telnet
    delete p.ftp
    const filtered = pickBy(p, (value) => value !== undefined && value !== '')
    return {
      ...tab,
      ...filtered
    }
  }
  Store.prototype.applyProfileToTabs = function (tab) {
    if (
      tab.connectionHoppings &&
      tab.connectionHoppings.length &&
      some(tab.connectionHoppings, s => s.profile)
    ) {
      tab.connectionHoppings = tab.connectionHoppings.map(s => {
        return window.store.applyProfile(s)
      })
    }
    return window.store.applyProfile(tab)
  }

  Store.prototype.getLangName = function (
    lang = window.store?.config.language || 'en_us'
  ) {
    return get(window.langMap, `[${lang}].name`)
  }

  Store.prototype.getLangNames = function () {
    return window.et.langs.map(d => d.name)
  }

  Store.prototype.fixProfiles = function () {
    const { profiles } = window.store
    const len = profiles.length
    let i = len - 1
    for (;i >= 0; i--) {
      const f = profiles[i]
      // migrate old rdp profile key userName -> username
      if (f.rdp?.userName !== undefined) {
        f.rdp.username = f.rdp.userName
        delete f.rdp.userName
      }
      if (f.name) {
        continue
      }
      let count = 0
      let id = 'PROFILE' + i
      while (profiles.find(d => d.id === id)) {
        count = count + 1
        id = 'PROFILE' + count
      }
      const np = deepCopy(f)
      np.id = id
      np.name = id
      profiles.splice(i, 1, np)
    }
  }

  Store.prototype.makeSureProfileDefault = function (defaultId) {
    const { profiles } = window.store
    for (const p of profiles) {
      if (p.id !== defaultId) {
        delete p.isDefault
      }
    }
  }

  Store.prototype.clearHistory = function () {
    window.store.history = []
  }

  Store.prototype.addCmdHistory = action(function (cmd) {
    if (!cmd || !cmd.trim()) {
      return
    }
    const { terminalCommandHistory } = window.store
    const existing = terminalCommandHistory.find(item => item.cmd === cmd)
    if (existing) {
      existing.count = existing.count + 1
      existing.lastUseTime = new Date().toISOString()
    } else {
      terminalCommandHistory.push({
        id: uid(),
        cmd,
        count: 1,
        lastUseTime: new Date().toISOString()
      })
    }
    if (terminalCommandHistory.length > 200) {
      // Delete oldest 20 items when history exceeds 100
      terminalCommandHistory.sort((a, b) => new Date(a.lastUseTime).getTime() - new Date(b.lastUseTime).getTime())
      terminalCommandHistory.splice(0, 20)
    }
  })

  Store.prototype.deleteCmdHistory = function (cmd) {
    const { terminalCommandHistory } = window.store
    const idx = terminalCommandHistory.findIndex(item => item.cmd === cmd)
    if (idx !== -1) {
      terminalCommandHistory.splice(idx, 1)
    }
  }

  Store.prototype.clearAllCmdHistory = function () {
    window.store.terminalCommandHistory = []
  }

  Store.prototype.runCmdFromHistory = function (cmd) {
    window.store.runQuickCommand(cmd)
    window.store.addCmdHistory(cmd)
  }
}
