import { useMemo, useState } from 'react'
import { auto } from 'manate/react'
import { Splitter } from 'antd'
import FolderTree from './folder-tree'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'

// 用实际字体测量当前祖先链，深目录在可用空间内自动获得更多宽度。
function directoryWidth (currentPath, remote, width) {
  const parts = currentPath.split(remote ? '/' : window.pre.sep).filter(Boolean)
  const context = document.createElement('canvas').getContext('2d')
  if (context) context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif'
  const needed = parts.reduce((maximum, part, index) => Math.max(maximum, (context?.measureText(part).width || part.length * 12) + (index + 1) * 24 + 70), 180)
  return Math.max(width * 0.23, needed)
}

// 两个面板共享实际宽度；只在拖动结束时保存偏好，窗口缩小时保留文件列表空间。
export default auto(function FileBrowser ({ width, height, currentPath, remote, renderFiles, tabId, ...treeProps }) {
  const part = remote ? 'remoteDirectoryLayout' : 'localDirectoryLayout'
  const saved = getWorkspaceState(tabId, part)
  const savedWidth = saved.width === undefined ? window.store.config.personalDirectoryWidth : saved.width
  const [dragWidth, setDragWidth] = useState(savedWidth ?? null)
  useWorkspaceState(tabId, part, () => ({ width: dragWidth }), [dragWidth])
  const automatic = useMemo(() => directoryWidth(currentPath, remote, width), [currentPath, remote, width])
  const minimum = Math.min(140, width * 0.28)
  const maximum = Math.max(minimum, width - Math.min(280, width * 0.5))
  const wanted = dragWidth ?? automatic
  const treeWidth = Math.round(Math.min(maximum, Math.max(minimum, wanted)))

  // 拖动时只更新当前组件，避免每一帧触发配置数据库写入。
  function resize (sizes) {
    setDragWidth(sizes[0])
  }

  // 保存当前标签页的最后尺寸，下次启动恢复该页自己的偏好。
  function saveWidth (sizes) {
    setDragWidth(Math.round(sizes[0]))
  }

  // 一次点击即可恢复随路径和窗口变化的自动宽度。
  function resetWidth () {
    setDragWidth(null)
  }

  return (
    <div className='personal-files' style={{ width, height }}>
      <Splitter className='personal-directory-splitter' onResize={resize} onResizeEnd={saveWidth}>
        <Splitter.Panel size={treeWidth} min={minimum} max={maximum} style={{ overflow: 'hidden' }}>
          <FolderTree {...treeProps} tabId={tabId} currentPath={currentPath} remote={remote} width={treeWidth} height={height} onAutoWidth={resetWidth} manualWidth={dragWidth !== null} />
        </Splitter.Panel>
        <Splitter.Panel size={Math.max(0, width - treeWidth)} min={Math.min(280, width * 0.5)} style={{ overflow: 'hidden' }}>
          {renderFiles(Math.max(0, width - treeWidth))}
        </Splitter.Panel>
      </Splitter>
    </div>
  )
})
