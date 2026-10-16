import { useEffect, useRef } from 'react'

const states = new Map()
const readers = new Map()

// 恢复或复制标签页时载入独立状态，运行中的其他标签不会共享对象。
export function seedWorkspaceState (tabId, state = {}) {
  states.set(tabId, JSON.parse(JSON.stringify(state)))
}

// 读取指定区域的初始状态，没有快照时使用组件原来的默认值。
export function getWorkspaceState (tabId, part) {
  return states.get(tabId)?.[part] || {}
}

// 注册区域状态读取器；隐藏区域卸载时仍保留其最后状态。
export function registerWorkspaceState (tabId, part, read) {
  if (!states.has(tabId)) states.set(tabId, {})
  if (!readers.has(tabId)) readers.set(tabId, new Map())
  const parts = readers.get(tabId)
  parts.set(part, read)
  return () => {
    if (readers.get(tabId)?.get(part) !== read) return
    states.set(tabId, { ...(states.get(tabId) || {}), [part]: read() })
    parts.delete(part)
    if (!parts.size) readers.delete(tabId)
  }
}

// 只采集当前标签自己的区域，不序列化 React、终端或网络对象。
export function captureWorkspaceState (tabId) {
  const state = { ...(states.get(tabId) || {}) }
  for (const [part, read] of readers.get(tabId) || []) state[part] = read()
  return state
}

// 删除关闭标签的缓存，避免长期运行累积已经不用的工作区。
export function pruneWorkspaceState (tabIds) {
  const keep = new Set(tabIds)
  for (const id of states.keys()) if (!keep.has(id)) states.delete(id)
  for (const id of readers.keys()) if (!keep.has(id)) readers.delete(id)
}

// 函数组件提供最新状态，变化合并为一次本地保存，关闭时可立即采集。
export function useWorkspaceState (tabId, part, read, dependencies) {
  const latest = useRef(read)
  latest.current = read
  useEffect(() => registerWorkspaceState(tabId, part, () => latest.current()), [tabId, part])
  useEffect(() => { window.store.scheduleWorkspaceSave?.() }, dependencies)
}
