import { debounce } from 'lodash-es'
import { refs } from '../components/common/ref'
import generate from '../common/id-with-stamp'
import { captureWorkspaceState, seedWorkspaceState, pruneWorkspaceState } from '../common/workspace-state'
import { flushExternalFiles } from '../common/external-editor'
import { addScreenTab } from '../common/screen-tabs'

const CONNECTION_FIELDS = ['type', 'title', 'host', 'port', 'username', 'authType', 'password', 'privateKey', 'passphrase', 'encode', 'term', 'enableSsh', 'enableSftp', 'sshSftpSplitView', 'startDirectory', 'startDirectoryLocal', 'startDirectoryRemote', 'proxy', 'hasHopping', 'connectionHoppings', 'profile', 'isPinned', 'screenSession', 'screenSourceId', 'screenTabsExpanded']
let ready = false
let saving = Promise.resolve()
let lastSnapshot = ''
const scheduledSave = debounce(() => {
  if (ready) window.store.saveWorkspaceSnapshot(false).catch(window.store.onError)
}, 800, { maxWait: 5000 })

// 恢复标签、目录和数据库的独立工作状态，不重放用户执行过的命令。
export default function personalWorkspace (Store) {
  // 更改状态合并写入，拖动和输入不会每个事件都写磁盘。
  Store.prototype.scheduleWorkspaceSave = function () {
    scheduledSave()
  }

  // 关闭时采集最近 200 行终端文本；日常保存只保留工作目录。
  Store.prototype.saveWorkspaceSnapshot = function (closing = false) {
    if (!ready) return Promise.resolve()
    const { store } = window
    const ids = store.tabs.map(tab => tab.id)
    const tabs = store.tabs.filter(tab => !tab.type || ['ssh', 'local'].includes(tab.type)).map(tab => {
      const state = captureWorkspaceState(tab.id)
      const terminal = refs.get('term-' + tab.id)
      const cwd = terminal?.cmdAddon?.getCwd() || state.layout?.cwd || tab._reloadState?.cwd || ''
      let screen = state.terminal?.screen || ''
      if (closing) {
        try {
          const value = terminal?.serializeAddon?.serialize({ scrollback: 200, excludeAltBuffer: true, excludeModes: true }) || ''
          screen = value.length <= 256 * 1024 ? value : ''
        } catch { screen = '' }
      }
      state.terminal = { cwd, screen }
      const connection = Object.fromEntries(CONNECTION_FIELDS.filter(key => tab[key] !== undefined).map(key => [key, tab[key]]))
      const bookmarkId = tab.srcId || ''
      if (bookmarkId) for (const key of ['password', 'privateKey', 'passphrase']) delete connection[key]
      return { id: tab.id, bookmarkId, connection, state }
    })
    pruneWorkspaceState(ids)
    const text = JSON.stringify({ version: 1, tabs, activeIndex: Math.max(0, ids.indexOf(store.activeTabId)) })
    if (text === lastSnapshot) return saving
    lastSnapshot = text
    const snapshot = JSON.parse(text)
    saving = saving.catch(() => {}).then(() => window.pre.runGlobalAsync('savePersonalWorkspace', snapshot)).catch(error => { lastSnapshot = ''; throw error })
    return saving
  }

  // 工作区优先于默认启动列表，空工作区也必须保持空标签页。
  Store.prototype.restoreWorkspaceSnapshot = async function () {
    const { store } = window
    const snapshot = await window.pre.runGlobalAsync('loadPersonalWorkspace')
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tabs)) { ready = true; return false }
    const restored = []
    const restoredIds = new Map()
    for (const entry of snapshot.tabs) {
      const bookmark = store.bookmarks.find(item => item.id === entry.bookmarkId)
      const connection = { ...entry.connection, ...(bookmark || {}) }
      const id = generate()
      const state = { ...entry.state }
      const legacy = state.consoles
      if (legacy?.screens) state.consoles = { detached: Boolean(legacy.mainDetached), bounds: legacy.mainBounds || {} }
      seedWorkspaceState(id, state)
      const terminal = entry.state?.terminal
      const tab = { ...connection, id, srcId: entry.bookmarkId || undefined, title: entry.connection?.title || connection.title, status: 'processing', batch: 0, _reloadState: terminal, _workspaceRestore: true }
      if (entry.connection?.screenSession) Object.assign(tab, { screenSession: entry.connection.screenSession, screenSourceId: entry.connection.screenSourceId, profile: undefined, sshTunnels: [], runScripts: [], enableSftp: false, autoReConnect: false })
      store.addTab(tab)
      restoredIds.set(entry.id, id)
      let selectedId = id
      // 0.6.0 的内层 screen 迁移为同级标签，保留独立窗口位置和原选择。
      for (const item of (legacy?.screens || []).slice(0, 32)) {
        const screen = addScreenTab(tab, item.name, { consoles: { detached: Boolean(item.detached), bounds: item.bounds || {} } })
        if (legacy.activeName === item.name) selectedId = screen.id
      }
      restored.push(selectedId)
    }
    for (const tab of store.tabs) if (tab.screenSourceId && restoredIds.has(tab.screenSourceId)) tab.screenSourceId = restoredIds.get(tab.screenSourceId)
    const active = restored[Math.min(restored.length - 1, Math.max(0, snapshot.activeIndex || 0))]
    if (active) store.changeActiveTabId(active)
    ready = true
    return true
  }

  // 收到原生关闭事件后先保存，再通知主进程退出。
  Store.prototype.prepareWorkspaceClose = async function () {
    try {
      scheduledSave.cancel()
      await flushExternalFiles()
      await window.store.saveWorkspaceSnapshot(true)
      await window.pre.runGlobalAsync('finishWorkspaceClose')
    } catch (error) {
      await window.pre.runGlobalAsync('cancelWorkspaceClose')
      if (window.store.externalEditorFiles.some(file => file.state === 'error')) window.store.externalEditorOpen = true
      window.store.onError(error)
    }
  }
}
