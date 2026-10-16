export const MINIMIZED_DATABASE_WIDTH = 44

// 终端和数据库使用同一套尺寸计算，窄窗口也不会挤出负宽度。
export function databaseLayout (width, mode, shellPercent = 50) {
  const total = Math.max(1, Number(width) || 1)
  const shellMin = Math.min(160, total * 0.3)
  const databaseMin = Math.min(248, total * 0.45)
  const percent = Number.isFinite(shellPercent) ? shellPercent : 50
  const databaseWidth = mode === 'hidden'
    ? 0
    : mode === 'minimized'
      ? Math.min(MINIMIZED_DATABASE_WIDTH, total - shellMin)
      : Math.min(total - shellMin, Math.max(databaseMin, total * (100 - percent) / 100))
  return { shellWidth: total - databaseWidth, databaseWidth, shellMin, databaseMin }
}

// 自动宽度照顾长名称，手动宽度优先；窗口缩小时始终给数据区留出空间。
export function objectBrowserLayout (width, preferredWidth, manualWidth = null) {
  const total = Math.max(1, Number(width) || 1)
  const minimum = Math.min(150, total * 0.3)
  const contentMinimum = Math.min(300, total * 0.6)
  const maximum = total - contentMinimum
  const automatic = Math.min(total * 0.4, Math.max(total * 0.24, preferredWidth))
  const wanted = Number.isFinite(manualWidth) ? manualWidth : automatic
  const treeWidth = Math.min(maximum, Math.max(minimum, wanted))
  return { treeWidth, minimum, maximum, contentMinimum }
}
