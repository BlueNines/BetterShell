import { useEffect, useMemo, useRef, useState } from 'react'
import { Tree, Dropdown, Button, Modal, Input } from 'antd'
import { FolderOutlined, ReloadOutlined, CopyOutlined, CodeOutlined, FolderAddOutlined, EditOutlined, DeleteOutlined, ExpandOutlined } from '@ant-design/icons'
import resolve from '../../common/resolve'
import { copy } from '../../common/clipboard'
import { getWorkspaceState, useWorkspaceState } from '../../common/workspace-state'
import { findFilePrefix } from '../../common/file-list-navigation'

// 更新指定目录的子节点，不递归扫描未展开的文件夹。
function treeForPath (currentPath, remote, cache) {
  // 合并当前路径的祖先链和已经读取的目录，不保留无限增长的树副本。
  function merge (node) {
    const children = [...(cache.get(node.key) || node.children || [])]
    const ancestor = node.children?.[0]
    if (ancestor && !children.some(child => child.key === ancestor.key)) children.push(ancestor)
    if (!children.length && !cache.has(node.key)) return node
    return { ...node, children: children.map(child => merge(child.key === ancestor?.key ? { ...child, children: ancestor.children } : child)) }
  }
  return initialTree(currentPath, remote).nodes.map(merge)
}

// 构造当前路径的祖先链，使深层初始目录立即可见。
function initialTree (currentPath, remote) {
  const separator = remote ? '/' : window.pre.sep
  const parts = (currentPath || '/').split(separator).filter(Boolean)
  const root = { title: remote ? '/' : '此电脑', key: '/', icon: <FolderOutlined /> }
  const expanded = ['/']
  let parent = root
  let folder = remote ? '/' : ''
  for (const part of parts) {
    folder = folder ? resolve(folder, part) : part + separator
    const child = { title: part, key: folder, icon: <FolderOutlined /> }
    parent.children = [child]
    parent = child
    expanded.push(folder)
  }
  return { nodes: [root], expanded }
}

// 仅测量已展开节点的标签，为虚拟目录树提供真实的横向滚动范围。
function visibleTreeWidth (nodes, expanded) {
  const context = document.createElement('canvas').getContext('2d')
  if (context) context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif'
  let maximum = 160
  // 未展开分支不参与测量，避免大目录反复递归遍历。
  function measure (items, depth) {
    for (const node of items) {
      maximum = Math.max(maximum, depth * 24 + (context?.measureText(node.title).width || node.title.length * 12) + 80)
      if (node.children && expanded.has(node.key)) measure(node.children, depth + 1)
    }
  }
  measure(nodes, 0)
  return Math.ceil(maximum)
}

// 懒加载目录树；缓存最多 128 个目录，卸载后忽略迟到响应。
export default function FolderTree ({ currentPath, remote, listDirectory, navigate, prefetchDirectory, currentList, width, height, loading, ready, onDirectoryAction, onAutoWidth, manualWidth, tabId }) {
  const part = remote ? 'remoteFolderTree' : 'localFolderTree'
  const saved = getWorkspaceState(tabId, part)
  const initial = useRef(initialTree(currentPath, remote))
  const [nodes, setNodes] = useState(initial.current.nodes)
  const [expanded, setExpanded] = useState([...new Set([...(saved.expanded || []), ...initial.current.expanded])])
  useWorkspaceState(tabId, part, () => ({ expanded }), [expanded])
  const [error, setError] = useState('')
  const [contextPath, setContextPath] = useState('')
  const [dialog, setDialog] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const tree = useRef(null)
  const prefixSearch = useRef(null)
  const [highlighted, setHighlighted] = useState(currentPath)
  const scrollWidth = useMemo(() => visibleTreeWidth(nodes, new Set(expanded)), [nodes, expanded])
  const cache = useRef(new Map())
  const alive = useRef(true)
  const activePath = useRef(currentPath)
  activePath.current = currentPath
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // 将目录列表转换为树节点并限制缓存规模。
  function childrenOf (folder, files) {
    return files.filter(file => file.isDirectory && file.name !== '..' && file.name !== '.').map(file => ({ title: file.name, key: resolve(folder, file.name), icon: <FolderOutlined /> }))
  }

  useEffect(() => {
    setHighlighted(currentPath)
    prefixSearch.current = null
    setExpanded(previous => [...new Set([...previous.filter(key => cache.current.has(key) || saved.expanded?.includes(key)), ...initialTree(currentPath, remote).expanded])])
    setNodes(treeForPath(currentPath, remote, cache.current))
    tree.current?.scrollTo({ key: currentPath })
  }, [currentPath])

  useEffect(() => {
    if (loading) return
    const children = childrenOf(currentPath, currentList)
    cache.current.set(currentPath, children)
    if (cache.current.size > 128) cache.current.delete(cache.current.keys().next().value)
    setNodes(treeForPath(currentPath, remote, cache.current))
  }, [currentPath, currentList, loading])

  useEffect(() => {
    if (!ready || !saved.expanded?.length) return
    let cancelled = false
    // 只重读以前展开的目录，最多 64 个，不扫描整台服务器。
    async function restoreExpanded () {
      for (const folder of saved.expanded.slice(0, 64)) {
        if (cancelled || !alive.current) return
        if (cache.current.has(folder)) continue
        try {
          const files = await listDirectory(folder)
          if (files && !cancelled && alive.current) cache.current.set(folder, childrenOf(folder, files))
        } catch {}
      }
      if (!cancelled && alive.current) setNodes(treeForPath(activePath.current, remote, cache.current))
    }
    restoreExpanded()
    return () => { cancelled = true }
  }, [ready])

  // 展开时读取一层目录，读取失败时允许用户再次重试。
  async function loadDirectory ({ key }, refresh = false) {
    try {
      const children = (!refresh && cache.current.get(key)) || childrenOf(key, await listDirectory(key, refresh))
      if (!alive.current) return
      cache.current.set(key, children)
      if (cache.current.size > 128) cache.current.delete(cache.current.keys().next().value)
      setNodes(treeForPath(activePath.current, remote, cache.current))
      setError('')
    } catch (error) {
      if (alive.current) setError('无法读取目录：' + error.message)
      throw error
    }
  }

  // 刷新只读取所选目录的一层内容，保留其他已展开目录的缓存。
  async function refreshDirectory (folder) {
    cache.current.delete(folder)
    if (folder === currentPath) await navigate(folder, true)
    else await loadDirectory({ key: folder }, true)
  }

  // 简单操作立即执行；更改名称和删除通过带路径的弹窗确认。
  function menuAction ({ key }) {
    const folder = contextPath
    if (key === 'open') return navigate(folder)
    if (key === 'copy') return copy(folder)
    if (key === 'refresh') return refreshDirectory(folder).catch(window.store.onError)
    if (key === 'terminal') return onDirectoryAction(key, folder).catch(window.store.onError)
    setName(key === 'rename' ? folder.split(remote ? '/' : window.pre.sep).filter(Boolean).at(-1) : '')
    setError('')
    setDialog({ action: key, folder })
  }

  // 校验单个目录名，并在成功后移除过期缓存、刷新当前文件列表。
  async function submitAction () {
    if (!dialog || busy) return
    const value = name.trim()
    if (dialog.action !== 'delete' && (!value || value === '.' || value === '..' || /[\\/\0]/.test(value) || (!remote && /[<>:"|?*]/.test(value)))) {
      setError('请输入有效的目录名称')
      return
    }
    setBusy(true)
    try {
      const target = await onDirectoryAction(dialog.action, dialog.folder, value)
      if (!alive.current) return
      cache.current.clear()
      setDialog(null)
      setError('')
      const affected = currentPath === dialog.folder || currentPath.startsWith(dialog.folder + (remote ? '/' : window.pre.sep))
      const nextPath = dialog.action === 'delete' ? target : target && resolve(target, currentPath.slice(dialog.folder.length).replace(/^[\\/]+/, ''))
      navigate(affected && nextPath ? nextPath : currentPath, true)
    } catch (error) {
      if (alive.current) setError(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  // 空白处不弹出上一次节点的菜单，避免操作错误的目录。
  function captureContextMenu (event) {
    if (event.target.closest('.ant-tree-treenode')) return
    event.preventDefault()
    event.stopPropagation()
  }

  // 方向键改变高亮但不立即切换目录，Enter 再打开当前项。
  function highlightDirectory (key) {
    if (!key) return
    prefixSearch.current = null
    setHighlighted(key)
  }

  // 左侧目录树也能按前缀定位，只查找已经可见的节点，不额外读取服务器。
  function keyDown (event) {
    if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('textarea, [contenteditable="true"]') || (event.target.matches('input') && !event.target.closest('.ant-tree'))) return
    if (event.key === 'Enter') {
      if (!highlighted || (!remote && highlighted === '/')) return
      event.preventDefault()
      event.stopPropagation()
      prefixSearch.current = null
      setExpanded(previous => [...new Set([...previous, highlighted])])
      navigate(highlighted)
    } else if (Array.from(event.key).length === 1 && event.key !== ' ') {
      const files = []
      const opened = new Set(expanded)
      // 与树的显示顺序一致，未展开分支不参与键盘匹配。
      function collect (items) { for (const node of items) { files.push({ id: node.key, name: node.title }); if (opened.has(node.key) && node.children) collect(node.children) } }
      collect(nodes)
      const match = findFilePrefix(files, prefixSearch.current, event.key, highlighted)
      prefixSearch.current = match
      event.preventDefault()
      event.stopPropagation()
      if (match.index >= 0) {
        const key = files[match.index].id
        setHighlighted(key)
        tree.current?.scrollTo({ key })
      }
    }
  }

  const root = contextPath === '/' || /^[a-z]:[\\/]?$/i.test(contextPath)
  const items = [
    { key: 'open', label: '打开目录', icon: <FolderOutlined /> },
    { key: 'terminal', label: '终端进入此目录', icon: <CodeOutlined />, disabled: contextPath === '/' && !remote },
    { key: 'copy', label: '复制完整路径', icon: <CopyOutlined /> },
    { key: 'refresh', label: '刷新目录', icon: <ReloadOutlined /> },
    { type: 'divider' },
    { key: 'create', label: '新建子目录', icon: <FolderAddOutlined />, disabled: contextPath === '/' && !remote },
    { key: 'rename', label: '重命名目录', icon: <EditOutlined />, disabled: root },
    { key: 'delete', label: '删除目录', icon: <DeleteOutlined />, danger: true, disabled: root }
  ]
  const titles = { create: '新建子目录', rename: '重命名目录', delete: '删除目录？' }
  return (
    <div className='personal-folder-tree'>
      <div className='personal-panel-heading'><span>目录</span><Button type='text' size='small' icon={<ExpandOutlined />} onClick={onAutoWidth} title='恢复自动目录宽度' aria-label='恢复自动目录宽度' disabled={!manualWidth}>自动</Button></div>
      {error && !dialog && <div className='personal-tree-error'>{error}</div>}
      <Dropdown menu={{ items, onClick: menuAction }} trigger={['contextMenu']}>
        <div onContextMenuCapture={captureContextMenu} onKeyDownCapture={keyDown} onBlur={() => { prefixSearch.current = null }}>
          <div className='personal-tree-content'><Tree ref={tree} scrollWidth={Math.max(width, scrollWidth)} height={Math.max(60, height - 45)} showIcon blockNode treeData={nodes} titleRender={node => <span title={node.key} onMouseEnter={() => prefetchDirectory(node.key)}>{node.title}</span>} loadedKeys={[...cache.current.keys()]} expandedKeys={expanded} onExpand={setExpanded} activeKey={highlighted} onActiveChange={highlightDirectory} selectedKeys={[highlighted]} loadData={loadDirectory} onRightClick={({ node }) => setContextPath(node.key)} onSelect={keys => { if (keys[0]) { setHighlighted(keys[0]); setExpanded(previous => [...new Set([...previous, keys[0]])]); navigate(keys[0]) } }} /></div>
        </div>
      </Dropdown>
      <Modal title={titles[dialog?.action]} open={Boolean(dialog)} onCancel={() => { if (!busy) { setDialog(null); setError('') } }} onOk={submitAction} confirmLoading={busy} okText={dialog?.action === 'delete' ? '删除' : '确定'} cancelText='取消' okButtonProps={{ danger: dialog?.action === 'delete' }}>
        <p className='personal-directory-target'>{dialog?.folder}</p>
        {dialog?.action === 'delete' ? <p>此目录及其中的文件将被删除。</p> : <Input autoFocus aria-label='目录名称' value={name} onChange={event => setName(event.target.value)} onPressEnter={submitAction} placeholder='目录名称' />}
        {error && <div className='personal-tree-error'>{error}</div>}
      </Modal>
    </div>
  )
}
