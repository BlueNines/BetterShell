import { loadTerminal, loadFitAddon } from './xterm-loader'
import { copy } from '../../common/clipboard'
import { fitTerminalWithHistory, setupTerminalHistory, terminalScrollback } from './terminal-history'

const popouts = new Map()
const DRAG_TYPE = 'application/x-bettershell-console'
let listening = false
let dockTarget = null

// 只接受顶部标签视口；按钮、终端内容和目录区域都不触发合并。
function getDockTarget (target) {
  if (target?.closest?.('button, input, .tab-close, .tab-reload')) return null
  return target?.closest?.('.personal-draggable-tabs > .tabs-inner') || null
}

// 提示直接标记实际接收区域，不改变标签栏尺寸。
function showDockTarget (target = null) {
  if (dockTarget === target) return
  dockTarget?.classList.remove('console-dock-target')
  dockTarget = target
  dockTarget?.classList.add('console-dock-target')
}

// 拖动标签时显示落点反馈，原终端连接不参与拖放序列化。
function dragOver (event) {
  if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
  event.stopPropagation()
  const target = getDockTarget(event.target)
  showDockTarget(target)
  if (!target) { event.dataTransfer.dropEffect = 'none'; return }
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

// 离开接收区域或取消拖动时立即撤下提示。
function dragLeave (event) {
  if (getDockTarget(event.relatedTarget) !== dockTarget) showDockTarget()
}

// 跨窗口拖动结束时清理主窗口提示，包括 Escape 和落在窗口外的情况。
function dragEnd () { showDockTarget() }

// 跨独立窗口的 HTML 拖放通过控制台标识定位原视图。
function dropConsole (event) {
  const controller = popouts.get(event.dataTransfer?.getData(DRAG_TYPE))
  showDockTarget()
  if (!controller) return
  event.preventDefault()
  event.stopPropagation()
  if (!controller.ready || controller.disposed || !getDockTarget(event.target)) return
  controller.dispose(true)
}

// 原生标题栏拖动使用同一标签视口边界，内容坐标按主窗口缩放转换。
function nativeDrop (event, { id, point, contentBounds, zoom }) {
  const controller = popouts.get(id)
  if (!controller?.ready || controller.disposed) return
  const target = document.elementFromPoint((point.x - contentBounds.x) / zoom, (point.y - contentBounds.y) / zoom)
  if (getDockTarget(target)) controller.dispose(true)
}

// 只在存在独立窗口时保留拖放监听，全部合回后释放主界面事件引用。
function listen () {
  if (listening) return
  listening = true
  document.addEventListener('dragover', dragOver, true)
  document.addEventListener('dragleave', dragLeave)
  document.addEventListener('drop', dropConsole, true)
  window.pre.ipcOnEvent('terminal-popout-moved', nativeDrop)
}

// 最后一个独立窗口关闭时清理拖放事件。
function unlisten () {
  if (popouts.size || !listening) return
  listening = false
  showDockTarget()
  document.removeEventListener('dragover', dragOver, true)
  document.removeEventListener('dragleave', dragLeave)
  document.removeEventListener('drop', dropConsole, true)
  window.pre.ipcOffEvent('terminal-popout-moved', nativeDrop)
}

// 为独立窗口建立显示视图；网络连接和完整终端状态始终留在原控制台。
export async function openTerminalPopout (host, title, onDock, bounds = {}) {
  if (!host.term || !host.socket || host.socket.readyState !== WebSocket.OPEN) throw new Error('请等待控制台连接成功')
  if (host.popout) { host.popout.window.focus(); return host.popout }
  const following = host.term.buffer.active.viewportY === host.term.buffer.active.baseY
  const width = Math.max(360, bounds.width || 1000)
  const height = Math.max(240, bounds.height || 640)
  const features = `width=${width},height=${height}${Number.isFinite(bounds.x) ? ',left=' + bounds.x : ''}${Number.isFinite(bounds.y) ? ',top=' + bounds.y : ''}`
  // 使用初始空白文档，避免异步 about:blank 导航清掉已经恢复的终端视图。
  const popup = window.open('', 'bettershell-console-' + host.props.tab.id, features)
  if (!popup) throw new Error('无法打开独立控制台窗口')
  const controller = { window: popup, viewer: null, fit: null, disposed: false, ready: false }
  host.popout = controller
  popouts.set(host.props.tab.id, controller)
  listen()

  // 当前窗口尺寸用于恢复布局，不序列化原生窗口或终端对象。
  controller.getBounds = () => ({ x: popup.screenX, y: popup.screenY, width: popup.outerWidth, height: popup.outerHeight })

  // 主模型解析完成后再转发输出，初始化期间的内容由主模型快照提供。
  controller.write = data => {
    if (controller.disposed) return
    if (controller.ready) controller.viewer.write(data)
  }

  // 只销毁多出的显示视图，关闭独立窗口后原 PTY 和 WebSocket 都继续使用。
  controller.dispose = (dock = true) => {
    if (controller.disposed) return
    const savedBounds = controller.getBounds()
    controller.disposed = true
    popup.removeEventListener('beforeunload', closed)
    popup.removeEventListener('resize', requestResize)
    popup.document.fonts?.removeEventListener('loadingdone', fontsLoaded)
    popup.document.removeEventListener('dragend', dragEnd)
    popup.cancelAnimationFrame(controller.resizeFrame)
    controller.observer?.disconnect()
    controller.history?.dispose()
    controller.viewer?.dispose()
    popouts.delete(host.props.tab.id)
    unlisten()
    if (host.popout === controller) host.popout = null
    host.projectedInput = false
    if (!popup.closed) popup.close()
    if (dock && !host.onClose) onDock(savedBounds)
  }

  // 原生关闭按钮等同于合回，服务端运行的程序不会随窗口关闭。
  function closed () { controller.dispose(true) }

  // 缩放独立窗口时，原控制台模型和同一个远程 PTY 一起采用实际列数。
  function resize (force = false) {
    if (!controller.viewer || controller.disposed || popup.closed) return
    try {
      fitTerminalWithHistory(controller.viewer, () => controller.fit.fit())
      const { cols, rows } = controller.viewer
      if (cols > 0 && rows > 0 && host.term) {
        const changed = host.term.cols !== cols || host.term.rows !== rows
        fitTerminalWithHistory(host.term, () => host.term.resize(cols, rows))
        host.onResizeTerminal?.({ cols, rows }, force && !changed)
      }
    } catch {}
  }
  controller.resize = resize

  // 原生窗口和容器可能同时报告变化，每帧只适配一次。
  function requestResize () {
    popup.cancelAnimationFrame(controller.resizeFrame)
    controller.resizeFrame = popup.requestAnimationFrame(() => resize())
  }

  // 自定义字体加载后重新测量字符尺寸；固定版本的 xterm 需要显式刷新测量服务。
  function fontsLoaded () {
    if (controller.disposed || !controller.viewer || popup.closed) return
    controller.viewer._core?._charSizeService?.measure()
    resize(true)
  }

  try {
    popup.document.title = title
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      const clone = node.cloneNode(true)
      if (node.tagName === 'LINK') clone.href = node.href
      popup.document.head.appendChild(clone)
    }
    const style = popup.document.createElement('style')
    style.textContent = 'html,body{height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column}.console-popout-toolbar{height:36px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#202a39;color:#c7d2e2;font:13px "Segoe UI","Microsoft YaHei",sans-serif;flex:none}.console-popout-toolbar span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.console-popout-toolbar button{background:transparent;color:inherit;border:1px solid #64748b;border-radius:4px;padding:3px 10px;cursor:pointer}.console-popout-view{flex:1;min-height:0;box-sizing:border-box}.console-popout-view .xterm{height:100%;padding:5px;box-sizing:border-box}'
    popup.document.head.appendChild(style)
    const toolbar = popup.document.createElement('div')
    toolbar.className = 'console-popout-toolbar'
    const label = popup.document.createElement('span')
    label.textContent = title
    label.draggable = true
    label.title = title + '\n拖到顶部标签栏即可合回，和 Shell 并列'
    label.style.cursor = 'grab'
    label.ondragstart = event => { event.dataTransfer.setData(DRAG_TYPE, host.props.tab.id); event.dataTransfer.effectAllowed = 'move' }
    popup.document.addEventListener('dragend', dragEnd)
    toolbar.appendChild(label)
    const button = popup.document.createElement('button')
    button.textContent = '合回标签栏'
    button.setAttribute('aria-label', '合回标签栏')
    button.onclick = () => controller.dispose(true)
    toolbar.appendChild(button)
    popup.document.body.appendChild(toolbar)
    const container = popup.document.createElement('div')
    container.className = 'console-popout-view'
    container.style.background = host.props.themeConfig.background
    popup.document.body.appendChild(container)
    const [Terminal, FitAddon] = await Promise.all([loadTerminal(), loadFitAddon()])
    if (controller.disposed || host.onClose) { controller.dispose(false); return controller }
    const viewer = new Terminal({ ...host.term.options, allowProposedApi: true, scrollback: terminalScrollback(host.term.options.scrollback) })
    controller.viewer = viewer
    controller.fit = new FitAddon()
    viewer.loadAddon(controller.fit)
    viewer.open(container)
    controller.history = setupTerminalHistory(viewer)
    // 回看位置同步到原模型，合回后仍停留在同一段历史。
    viewer.onScroll(position => { if (controller.historyReady) host.term?.scrollToLine(position) })
    viewer.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && viewer.hasSelection()) {
        if (event.type === 'keydown') copy(viewer.getSelection())
        return false
      }
      return true
    })
    viewer.onData(data => {
      if (host.socket?.readyState !== WebSocket.OPEN) return
      host.handleInputEvent?.(data)
      host.attachAddon?.sendToServer(data, true)
    })
    viewer.onBinary(data => { if (host.socket?.readyState === WebSocket.OPEN) host.attachAddon?.sendToServer(Uint8Array.from(data, character => character.charCodeAt(0)), true) })
    // 独立视图的 DSR 回应由它自己接收，主视图不再重复向远程发送终端回应。
    host.projectedInput = true
    popup.addEventListener('beforeunload', closed)
    popup.addEventListener('resize', requestResize)
    popup.document.fonts?.addEventListener('loadingdone', fontsLoaded)
    popup.document.fonts?.ready.then(fontsLoaded)
    controller.observer = new popup.ResizeObserver(requestResize)
    controller.observer.observe(container)
    resize(true)
    // 原模型在同一同步任务中采集已解析内容，随后开始转发后续输出。
    const historyPosition = host.term.buffer.active.viewportY
    viewer.write(host.serializeAddon.serialize({ scrollback: viewer.options.scrollback, excludeAltBuffer: false, excludeModes: false }), () => {
      if (controller.disposed) return
      if (following) viewer.scrollToBottom()
      else viewer.scrollToLine(historyPosition)
      controller.historyReady = true
    })
    controller.ready = true
    viewer.focus()
    return controller
  } catch (error) { controller.dispose(false); throw error }
}
