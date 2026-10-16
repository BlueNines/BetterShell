import { useEffect, useMemo, useRef, useState } from 'react'
import { cellText } from './values'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'

// 找到视口附近的列，横向也只渲染当前能看见的单元格。
function columnAt (offsets, left) {
  let start = 0
  let end = offsets.length - 1
  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    if (offsets[middle] < left) start = middle + 1
    else end = middle
  }
  return Math.max(0, start - 1)
}

// 行和列双向虚拟化，长结果不创建成千上万个 DOM 节点。
export default function DatabaseGrid ({ result, selected, onSelect, onOpenCell, onSort, sort, tabId, workspacePart, resetKey }) {
  const restoredScroll = useRef(getWorkspaceState(tabId, workspacePart)).current
  const restorePending = useRef(true)
  const viewport = useRef(null)
  const [size, setSize] = useState({ width: 600, height: 200 })
  const [scroll, setScroll] = useState({ top: restoredScroll.top || 0, left: restoredScroll.left || 0 })
  useWorkspaceState(tabId, workspacePart, () => scroll, [scroll.top, scroll.left])
  const frame = useRef(null)
  const columns = result?.columns || []
  const rows = result?.rows || []
  const offsets = useMemo(() => {
    const positions = [38]
    for (const column of columns) positions.push(positions.at(-1) + Math.min(220, Math.max(132, column.name.length * 10 + 44)))
    return positions
  }, [columns])
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect
      setSize({ width: rect.width, height: rect.height })
    })
    if (viewport.current) observer.observe(viewport.current)
    return () => { observer.disconnect(); if (frame.current) window.cancelAnimationFrame(frame.current) }
  }, [])
  useEffect(() => {
    if (!result) return
    const position = restorePending.current ? { top: restoredScroll.top || 0, left: restoredScroll.left || 0 } : { top: 0, left: 0 }
    restorePending.current = false
    if (viewport.current) { viewport.current.scrollTop = position.top; viewport.current.scrollLeft = position.left }
    setScroll(position)
  }, [resetKey ?? result])

  // 合并一帧内的滚动更新，不在每个鼠标事件中重绘表格。
  function onScroll (event) {
    const { scrollTop: top, scrollLeft: left } = event.currentTarget
    if (frame.current) window.cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { frame.current = null; setScroll({ top, left }) })
  }

  // 方向键选择行，并自动滚动到所选记录。
  function onKeyDown (event) {
    if (!rows.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.max(0, Math.min(rows.length - 1, (selected ?? 0) + (event.key === 'ArrowDown' ? 1 : -1)))
      onSelect(next)
      const top = next * 28
      if (top < scroll.top) viewport.current.scrollTop = top
      if (top > scroll.top + size.height - 56) viewport.current.scrollTop = top - size.height + 56
    }
  }

  const firstRow = Math.max(0, Math.floor(scroll.top / 28) - 2)
  const lastRow = Math.min(rows.length, firstRow + Math.ceil(size.height / 28) + 5)
  const firstColumn = Math.max(0, columnAt(offsets, scroll.left) - 1)
  const lastColumn = Math.min(columns.length, columnAt(offsets, scroll.left + size.width) + 3)
  const visibleColumns = columns.slice(firstColumn, lastColumn)
  return (
    <div className='mysql-grid' role='grid' aria-label='数据库数据表格' tabIndex={0} onKeyDown={onKeyDown}>
      <div className='mysql-grid-heading'>
        <div className='mysql-grid-number'>#</div>
        {visibleColumns.map((column, localIndex) => {
          const index = firstColumn + localIndex
          return <button className='mysql-grid-column' role='columnheader' key={index} style={{ left: offsets[index] - scroll.left, width: offsets[index + 1] - offsets[index] }} title={column.name + ' · ' + column.type} onClick={() => onSort?.(column.name)}><span>{column.name}</span>{sort?.column === column.name && <small>{sort.direction === 'asc' ? '↑' : '↓'}</small>}</button>
        })}
      </div>
      <div className='mysql-grid-viewport' ref={viewport} onScroll={onScroll}>
        <div className='mysql-grid-canvas' style={{ width: Math.max(size.width, offsets.at(-1)), height: rows.length * 28 }}>
          {rows.slice(firstRow, lastRow).map((row, localIndex) => {
            const rowIndex = firstRow + localIndex
            return (
              <div role='row' className={'mysql-grid-row ' + (selected === rowIndex ? 'selected' : '')} key={rowIndex} style={{ top: rowIndex * 28, width: Math.max(size.width, offsets.at(-1)) }} onClick={() => onSelect(rowIndex)}>
                <div className='mysql-grid-number' style={{ left: scroll.left }}>{rowIndex + 1 + (result.offset || 0)}</div>
                {visibleColumns.map((column, localColumn) => {
                  const index = firstColumn + localColumn
                  const value = row[index]
                  return <div role='gridcell' className={'mysql-grid-cell ' + (value === null ? 'is-null' : value?.kind ? 'is-binary' : '')} key={index} style={{ left: offsets[index], width: offsets[index + 1] - offsets[index] }} title={cellText(value).slice(0, 600)} onDoubleClick={() => onOpenCell(rowIndex, index)}>{cellText(value)}</div>
                })}
              </div>
            )
          })}
        </div>
        {!rows.length && <div className='mysql-grid-empty'>{columns.length ? '暂无记录' : '选择一张表，或运行 SQL 查询'}</div>}
      </div>
    </div>
  )
}
