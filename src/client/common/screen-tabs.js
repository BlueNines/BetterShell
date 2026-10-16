import generate from './id-with-stamp'
import deepCopy from 'json-deep-copy'
import { seedWorkspaceState } from './workspace-state'

// screen 成为服务器旁边的顶层标签，复用账号配置但拥有独立连接生命周期。
export function addScreenTab (source, session, state) {
  const { store } = window
  source.screenTabsExpanded = true
  const existing = store.tabs.find(tab => tab.screenSession === session && tab.screenSourceId === source.id)
  if (existing) { store.changeActiveTabId(existing.id); return existing }
  if (store.tabs.filter(tab => tab.screenSession && tab.screenSourceId === source.id).length >= 32) throw new Error('每个服务器最多打开 32 个 screen 标签')
  const connection = store.applyProfileToTabs(deepCopy(source))
  const tab = { ...connection, id: generate(), type: 'ssh', title: `${source.title || source.host} · ${session.slice(session.indexOf('.') + 1)}`, screenSession: session, screenSourceId: source.id, status: 'processing', pane: 'terminal', profile: undefined, sshTunnels: [], runScripts: [], enableSftp: false, sshSftpSplitView: false, autoReConnect: false }
  for (const key of ['screenParentId', 'screenTabsExpanded', '_reloadState', '_workspaceRestore', 'sftpCreated', 'sshTunnelResults', 'isTransporting', 'isPinned']) delete tab[key]
  const index = store.tabs.findIndex(tab => tab.id === source.id) + 1
  const siblings = store.tabs.filter(tab => tab.screenSourceId === source.id).length
  if (state) seedWorkspaceState(tab.id, state)
  store.addTab(tab, index + siblings, source.batch)
  return tab
}

// 收起只隐藏这台 Shell 已打开的 screen 标签，不停止控制台或独立窗口。
export function toggleScreenTabs (source) {
  const { store } = window
  source.screenTabsExpanded = source.screenTabsExpanded === false
  if (!source.screenTabsExpanded && store.tabs.some(tab => tab.id === store.activeTabId && tab.screenSourceId === source.id)) store.changeActiveTabId(source.id)
  store.scheduleWorkspaceSave()
}

// 过滤显示用的标签，原数组和控制台实例保留；父 Shell 已关闭的 screen 仍可显示。
export function visibleScreenTabs (tabs) {
  const sources = new Map(tabs.filter(tab => !tab.screenSession).map(tab => [tab.id, tab]))
  return tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !tab.screenSession || sources.get(tab.screenSourceId)?.screenTabsExpanded !== false)
}
