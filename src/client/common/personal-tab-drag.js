import { isDropAfterHalf } from './drop-position.js'

// 标签栏外留出一点容差，避免轻微上下抖动误弹出窗口。
export function isOutsideTabBar (point, bounds) {
  const margin = 12
  return point.clientX < bounds.left - margin || point.clientX > bounds.right + margin || point.clientY < bounds.top - margin || point.clientY > bounds.bottom + margin
}

// 按移除源标签后的数组计算插入位置，空白区域允许移到最后。
export function getTabDropIndex (tabs, sourceId, targetId, after = false) {
  const from = tabs.findIndex(tab => tab.id === sourceId)
  if (from < 0 || sourceId === targetId) return -1
  if (!targetId) return tabs.length - 1
  const target = tabs.findIndex(tab => tab.id === targetId)
  if (target < 0) return -1
  const index = target + Number(after)
  return index - Number(from < index)
}

// 指针捕获能收到主窗口外的松开事件；一次拖动结束即释放全部监听和预览。
export function startTabDrag (event, bar, source, title, { onReorder, onDetach, onFinish }) {
  const { pointerId, clientX, clientY } = event
  let moving = false
  let preview
  let target
  let after = false
  let ended = false

  // 移动时只更新一个 DOM 预览，避免逐帧重渲染整个工作区。
  function move (point) {
    if (point.pointerId !== pointerId) return
    if (!moving && Math.hypot(point.clientX - clientX, point.clientY - clientY) < 8) return
    if (!moving) {
      moving = true
      bar.setPointerCapture(pointerId)
      source.classList.add('ondrag-tab')
      preview = document.createElement('div')
      preview.className = 'personal-tab-drag-preview'
      document.body.appendChild(preview)
    }
    point.preventDefault()
    target?.classList.remove('dragover-tab', 'dragover-tab-after')
    const outside = isOutsideTabBar(point, bar.getBoundingClientRect())
    target = outside ? null : document.elementFromPoint(point.clientX, point.clientY)?.closest('.tab')
    if (target && !bar.contains(target)) target = null
    after = isDropAfterHalf(point, target, true)
    if (target && target !== source) target.classList.add(after ? 'dragover-tab-after' : 'dragover-tab')
    preview.textContent = `${title} · ${outside ? '松开创建独立窗口' : '移动标签'}`
    preview.dataset.mode = outside ? 'detach' : 'reorder'
    preview.style.transform = `translate(${point.clientX + 12}px, ${point.clientY + 12}px)`
  }

  // 清理也用于 Escape、指针取消和组件卸载，取消时不改变标签或连接。
  function cleanup () {
    if (ended) return
    ended = true
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', release)
    document.removeEventListener('pointercancel', cancel)
    document.removeEventListener('keydown', keydown)
    bar.removeEventListener('lostpointercapture', cancel)
    if (bar.hasPointerCapture(pointerId)) bar.releasePointerCapture(pointerId)
    source.classList.remove('ondrag-tab')
    target?.classList.remove('dragover-tab', 'dragover-tab-after')
    preview?.remove()
    onFinish(moving)
  }

  // 在标签栏内排序，拖出标签栏则弹出相同控制台，绝不新建 SSH 会话。
  function release (point) {
    if (point.pointerId !== pointerId) return
    const detached = moving && isOutsideTabBar(point, bar.getBoundingClientRect())
    const targetId = target?.getAttribute('data-id')
    cleanup()
    if (!moving) return
    if (detached) onDetach({ x: Math.round(point.screenX - 120), y: Math.round(point.screenY - 20) })
    else onReorder(targetId, after)
  }

  // 只取消当前这一根指针，不让其他触摸操作结束鼠标拖动。
  function cancel (point) { if (point.pointerId === pointerId) cleanup() }

  // 拖到一半按 Escape 可取消，松开鼠标也不会生成窗口。
  function keydown (key) { if (key.key === 'Escape') { key.preventDefault(); cleanup() } }

  document.addEventListener('pointermove', move, { passive: false })
  document.addEventListener('pointerup', release)
  document.addEventListener('pointercancel', cancel)
  document.addEventListener('keydown', keydown)
  bar.addEventListener('lostpointercapture', cancel)
  return cleanup
}
