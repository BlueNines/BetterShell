import { Button } from 'antd'
import { PlusOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { action } from 'manate'
import { auto } from 'manate/react'
import Tab from '../tabs/tab'
import ConnectionPicker from './connections'
import ScreenPicker from './screen-picker'
import { refs } from '../common/ref'
import { getTabDropIndex, startTabDrag } from '../../common/personal-tab-drag'
import { toggleScreenTabs, visibleScreenTabs } from '../../common/screen-tabs'
import '../tabs/tabs.styl'

// 加号可选择已保存的服务器，也能新建连接和本机终端。
export default auto(function PersonalTabs (props) {
  const bar = useRef(null)
  const viewport = useRef(null)
  const contents = useRef(null)
  const drag = useRef(null)
  const suppressClickUntil = useRef(0)
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false })
  const visible = visibleScreenTabs(props.tabs)
  const openedSources = new Set(props.tabs.filter(tab => tab.screenSession).map(tab => tab.screenSourceId))
  useEffect(() => () => drag.current?.(), [])

  // 只在滚动边界变化时更新按钮，不逐帧重新渲染所有标签。
  function refreshScroll () {
    const list = viewport.current
    const root = bar.current
    if (!list || !root) return
    const addWidth = root.querySelector('.personal-add-tab')?.offsetWidth || 40
    const next = { overflow: list.scrollWidth > root.clientWidth - addWidth + 1, left: list.scrollLeft > 1, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1 }
    setScroll(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next)
  }

  // 切换或打开标签后定位到当前项；极长名称从开头显示，仍可横向滚动查看尾部。
  function revealActive () {
    const list = viewport.current
    const tab = list?.querySelector('.tab.active')?.closest('.personal-top-tab')
    if (!tab) return
    const area = list.getBoundingClientRect()
    const item = tab.getBoundingClientRect()
    const left = item.left - area.left + list.scrollLeft
    if (item.width > list.clientWidth || item.left < area.left) list.scrollLeft = left
    else if (item.right > area.right) list.scrollLeft = left + item.width - list.clientWidth
    refreshScroll()
  }

  // 同时观察窗口和标题内容宽度，重命名也会立即更新溢出状态。
  useEffect(() => {
    let frame = 0
    // 合并同一帧的多次尺寸通知，避免读写布局循环。
    function resized () { window.cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { refreshScroll(); revealActive() }) }
    // 普通滚轮用于浏览标签，触控板水平滚动和浏览器缩放保留原有行为。
    function wheel (event) {
      const list = viewport.current
      if (event.ctrlKey || event.metaKey || !list || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const before = list.scrollLeft
      list.scrollLeft += event.deltaY
      if (list.scrollLeft !== before) event.preventDefault()
    }
    const observer = new ResizeObserver(resized)
    for (const element of [bar.current, viewport.current, contents.current]) if (element) observer.observe(element)
    const list = viewport.current
    list?.addEventListener('wheel', wheel, { passive: false })
    resized()
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); list?.removeEventListener('wheel', wheel) }
  }, [])
  useEffect(revealActive, [props.currentBatchTabId, props.tabs.length])

  // 导航按钮始终在可见区域，加号不会随长标签一起滚出窗口。
  function scrollTabs (direction) {
    const list = viewport.current
    list?.scrollBy({ left: direction * Math.max(180, list.clientWidth * 0.65), behavior: 'smooth' })
  }

  // 普通点击和关闭按钮照常处理，仅标签标题左键拖动进入排序或弹出操作。
  function pointerDown (event) {
    if (event.button !== 0 || event.isPrimary === false) return
    suppressClickUntil.current = 0
    if (event.target.closest('button, input, .tab-close, .tab-reload')) return
    const source = event.target.closest('.tab')
    const tab = window.store.tabs.find(tab => tab.id === source?.getAttribute('data-id'))
    if (!tab || !bar.current) return
    drag.current?.()
    drag.current = startTabDrag(event, bar.current, source, tab.title || tab.host || '控制台', {
      // 使用现有标签对象排序，终端、目录和 MySQL 工作区不会重新挂载。
      onReorder (targetId, after) {
        const tabs = window.store.tabs
        const from = tabs.findIndex(item => item.id === tab.id)
        const to = getTabDropIndex(tabs, tab.id, targetId, after)
        if (to < 0 || to === from) return
        action(() => { const [item] = tabs.splice(from, 1); tabs.splice(to, 0, item) })()
        window.store.scheduleWorkspaceSave()
      },
      // 弹出复用所属控制台的操作，并让新窗口靠近松开鼠标的位置。
      onDetach (position) {
        window.store.changeActiveTabId(tab.id)
        refs.get('console-' + tab.id)?.popout(position)
      },
      // 拖动后的点击不能触发切换或双击复制标签。
      onFinish (moved) { drag.current = null; if (moved) suppressClickUntil.current = Date.now() + 350 }
    })
  }

  // 保留未拖动时的点击，丢弃拖动松开产生的那一次点击。
  function click (event) {
    if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation() }
  }

  return (
    <div className='tabs personal-draggable-tabs' ref={bar} onPointerDown={pointerDown} onClickCapture={click} onDoubleClickCapture={click}>
      {scroll.overflow && <Button className='personal-tab-scroll' type='text' icon={<LeftOutlined />} aria-label='向左滚动标签' title='向左滚动标签' disabled={!scroll.left} onClick={() => scrollTabs(-1)} />}
      <div className='tabs-inner' ref={viewport} onScroll={refreshScroll}>
        <div className='tabs-wrapper' ref={contents}>
          {visible.map(({ tab, index }, position) => {
            const hasScreens = openedSources.has(tab.id)
            const expanded = hasScreens && tab.screenTabsExpanded !== false
            return (
              <div className='personal-top-tab' key={tab.id}>
                <Tab {...props} tab={tab} tabIndex={index} draggable={false} isLast={position === visible.length - 1} addTab={window.store.onNewSsh} />
                {tab.host && !tab.screenSession && <><ScreenPicker tab={tab} /><Button className='shell-screen-pull' size='small' type='text' icon={<RightOutlined rotate={expanded ? 180 : 0} />} aria-label={'显示或收起已打开的 screen · ' + (tab.title || tab.host)} aria-expanded={expanded} title={hasScreens ? (expanded ? '收起' : '展开') + '这台 Shell 已经打开的 screen' : '这台 Shell 尚未打开 screen'} disabled={!hasScreens} onClick={() => toggleScreenTabs(tab)} /></>}
              </div>
            )
          })}
        </div>
      </div>
      {scroll.overflow && <Button className='personal-tab-scroll' type='text' icon={<RightOutlined />} aria-label='向右滚动标签' title='向右滚动标签' disabled={!scroll.right} onClick={() => scrollTabs(1)} />}
      <ConnectionPicker store={window.store}><Button className='personal-add-tab' type='text' icon={<PlusOutlined />} aria-label='打开连接列表' title='选择服务器或新建连接' /></ConnectionPicker>
    </div>
  )
})
