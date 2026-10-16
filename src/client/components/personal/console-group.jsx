import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import Term from '../terminal/terminal'
import { refs } from '../common/ref'
import { openTerminalPopout } from '../terminal/terminal-popout'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'
import './console-group.styl'

// 一个顶层标签只有一个控制台，弹出与合回只改变显示位置。
export default forwardRef(function ConsoleGroup (props, ref) {
  const { tab, width, height, onDetachedChange } = props
  const saved = useRef(getWorkspaceState(tab.id, 'consoles')).current
  const [detached, setDetached] = useState(Boolean(saved.detached ?? saved.mainDetached))
  const [bounds, setBounds] = useState(saved.bounds || saved.mainBounds || {})
  const [ready, setReady] = useState(false)
  const alive = useRef(true)
  const popping = useRef(false)
  const controller = useRef({})
  useWorkspaceState(tab.id, 'consoles', () => ({ detached, bounds: refs.get('term-' + tab.id)?.popout?.getBounds() || bounds }), [detached, bounds])
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => { onDetachedChange?.(detached) }, [detached])

  // 合回选择这个控制台自己的顶部标签，网络连接和当前程序保持不变。
  function dock (position) {
    if (!alive.current) return
    setDetached(false)
    setBounds(position)
    window.store.changeActiveTabId(tab.id)
    window.pre.runGlobalAsync('focusTerminalOwner').catch(window.store.onError)
    requestAnimationFrame(() => { const host = refs.get('term-' + tab.id); host?.fitAndRefresh(true); host?.term?.focus() })
  }

  // 独立窗口保留相同终端模型，退出独立窗口相当于合回顶层标签。
  async function popout (position = {}) {
    if (popping.current) return
    popping.current = true
    try {
      const host = refs.get('term-' + tab.id)
      if (!host) throw new Error('控制台尚未就绪')
      await openTerminalPopout(host, tab.title || '控制台', dock, { ...bounds, ...position })
      if (alive.current) setDetached(true)
    } catch (error) { if (alive.current) setDetached(false); window.store.onError(error) } finally { popping.current = false }
  }

  // 工具栏和独立窗口复用同一显示切换，不增加第二层标签。
  function togglePopout () {
    if (!detached) return popout()
    const controller = refs.get('term-' + tab.id)?.popout
    if (controller) controller.dispose(true)
    else dock(bounds)
  }

  controller.current.popout = popout
  controller.current.togglePopout = togglePopout
  useImperativeHandle(ref, () => controller.current, [detached, bounds])
  useEffect(() => { refs.add('console-' + tab.id, controller.current); return () => refs.remove('console-' + tab.id) }, [tab.id])
  useEffect(() => { if (detached && ready && !refs.get('term-' + tab.id)?.popout) popout() }, [detached, ready])

  return (
    <div className='personal-console-group' data-console-owner={tab.id} style={{ width, height }}>
      <div className='personal-console-views' style={{ height }}>
        <div className='personal-console-view' style={{ display: detached ? 'none' : 'block' }}><Term {...props} onTerminalReady={() => setReady(true)} /></div>
        {detached && <div className='personal-console-detached'><ExportOutlined /><p>当前控制台正在独立窗口中显示</p><Button size='small' onClick={togglePopout}>合回顶部标签</Button></div>}
      </div>
    </div>
  )
})
