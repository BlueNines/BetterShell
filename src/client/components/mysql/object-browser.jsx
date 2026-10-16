import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Splitter, Tree, Tooltip } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import { objectBrowserLayout } from './layout'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'

// 仅测量当前展开的库表名称，提供完整的横向滚动范围。
function visibleTreeWidth (nodes, expandedKeys) {
  const context = document.createElement('canvas').getContext('2d')
  if (context) context.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif'
  const expanded = new Set(expandedKeys)
  let maximum = 180
  // 未展开的数据库不参与测量，也不会触发远程表读取。
  function measure (items, depth) {
    for (const node of items) {
      maximum = Math.max(maximum, (context?.measureText(node.title).width || node.title.length * 11) + depth * 24 + 78)
      if (node.children && expanded.has(node.key)) measure(node.children, depth + 1)
    }
  }
  measure(nodes, 0)
  return Math.ceil(maximum)
}

// 库表树与数据区共享真实可用尺寸，每个标签页独立保存展开和拖动状态。
export default function MysqlObjectBrowser ({ treeData, schema, selectedKey, busy, search, onSearch, loadData, onSelect, children, tabId }) {
  const saved = useRef(getWorkspaceState(tabId, 'mysqlObjects')).current
  const restored = useRef(false)
  const root = useRef(null)
  const treeViewport = useRef(null)
  const [size, setSize] = useState({ width: 600, treeHeight: 200 })
  const [expandedKeys, setExpandedKeys] = useState(saved.expandedKeys || [])
  const [manualWidth, setManualWidth] = useState(saved.manualWidth ?? null)
  const [visibility, setVisibility] = useState(saved.visibility ?? null)
  useWorkspaceState(tabId, 'mysqlObjects', () => ({ expandedKeys, manualWidth, visibility }), [expandedKeys, manualWidth, visibility])
  const visible = visibility ?? size.width >= 530
  const scrollWidth = useMemo(() => visibleTreeWidth(treeData, expandedKeys), [treeData, expandedKeys])
  const layout = objectBrowserLayout(size.width, scrollWidth, manualWidth)
  const treeWidth = visible ? layout.treeWidth : 0

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      setSize(previous => {
        let width = previous.width
        let treeHeight = previous.treeHeight
        for (const entry of entries) {
          if (entry.target === root.current && entry.contentRect.width > 0) width = Math.round(entry.contentRect.width)
          if (entry.target === treeViewport.current && entry.contentRect.height > 0) treeHeight = Math.floor(entry.contentRect.height)
        }
        return width === previous.width && treeHeight === previous.treeHeight ? previous : { width, treeHeight }
      })
    })
    if (root.current) observer.observe(root.current)
    if (treeViewport.current) observer.observe(treeViewport.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!schema) return
    const key = JSON.stringify(['database', schema])
    setExpandedKeys(previous => previous.includes(key) ? previous : [...previous, key])
  }, [schema])

  useEffect(() => {
    if (busy || restored.current || !treeData.length) return
    restored.current = true
    // 仅重读之前展开的库清单，不执行 SQL 编辑器中的任何语句。
    async function restoreDatabases () {
      for (const key of (saved.expandedKeys || []).slice(0, 32)) {
        const node = treeData.find(node => node.key === key)
        if (node && !node.children) await loadData(node)
      }
    }
    restoreDatabases().catch(() => {})
  }, [busy, treeData])

  // 拖动仅修改当前标签的宽度，其他标签和数据库连接不受影响。
  function resize (sizes) {
    if (visible && sizes[0] > 0) setManualWidth(Math.round(sizes[0]))
  }

  // 自动按钮或双击分隔线恢复随名称和窗口变化的尺寸。
  function resetWidth () {
    setManualWidth(null)
  }

  // 小面板默认收起对象树，但用户仍可以主动展开并调整。
  function toggleObjects () {
    setVisibility(!visible)
  }

  return (
    <div className='mysql-workspace' ref={root}>
      <Splitter className={'mysql-object-splitter' + (visible ? '' : ' objects-hidden')} onResize={resize} onResizeEnd={resize} onDraggerDoubleClick={resetWidth}>
        <Splitter.Panel size={treeWidth} min={visible ? layout.minimum : 0} max={visible ? layout.maximum : 0} resizable={visible} style={{ overflow: 'hidden' }}>
          <aside className='mysql-objects' hidden={!visible} aria-label='MySQL 库表列表' data-width-mode={manualWidth === null ? 'auto' : 'manual'}>
            <div className='mysql-objects-heading'><span>库表</span><Tooltip title='恢复自动宽度；也可双击分隔线'><Button size='small' type='text' aria-label='恢复库表列表自动宽度' icon={<ExpandOutlined />} onClick={resetWidth} disabled={manualWidth === null}>自动</Button></Tooltip></div>
            <Input size='small' aria-label='搜索数据库和表' placeholder='搜索库 / 已加载的表' value={search} onChange={event => onSearch(event.target.value)} allowClear />
            <div className='mysql-tree-viewport' ref={treeViewport}><Tree disabled={busy} showIcon blockNode height={Math.max(40, size.treeHeight)} scrollWidth={Math.max(treeWidth - 12, scrollWidth)} treeData={treeData} expandedKeys={expandedKeys} onExpand={setExpandedKeys} selectedKeys={selectedKey ? [selectedKey] : []} loadData={loadData} onSelect={onSelect} titleRender={node => <span title={node.title}>{node.title}</span>} /></div>
          </aside>
        </Splitter.Panel>
        <Splitter.Panel size={Math.max(0, size.width - treeWidth)} min={visible ? layout.contentMinimum : 0} resizable={visible} style={{ overflow: 'hidden' }}>
          {children(visible, toggleObjects)}
        </Splitter.Panel>
      </Splitter>
    </div>
  )
}
