const { screen } = require('electron')
const globalState = require('./glob-state')
const { showMainWindow } = require('./window-restore')

// 显式采用保存的外框尺寸，避免 window.open 在 Windows 缩放下再次换算宽度。
function terminalWindowBounds (features) {
  const bounds = {}
  const names = { width: 'width', height: 'height', left: 'x', top: 'y' }
  for (const field of String(features || '').split(',')) {
    const [name, raw] = field.split('=').map(value => value.trim())
    const key = names[name]
    const value = Number(raw)
    if (!key || raw === undefined || !Number.isFinite(value)) continue
    if ((key === 'width' || key === 'height') && value <= 0) continue
    bounds[key] = Math.round(value)
  }
  return bounds
}

// 只允许同源空白终端窗口；内容由主界面写入，不加载外部页面或 Node 能力。
exports.configureTerminalPopouts = function (win) {
  const requestedBounds = new Map()
  win.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
    if (url !== 'about:blank' || !/^bettershell-console-[\w-]+$/.test(frameName)) return { action: 'deny' }
    const bounds = terminalWindowBounds(features)
    requestedBounds.set(frameName, bounds)
    return { action: 'allow', overrideBrowserWindowOptions: { ...bounds, useContentSize: false, autoHideMenuBar: true, minWidth: 360, minHeight: 240, backgroundColor: '#18202b', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, spellcheck: false, backgroundThrottling: false } } }
  })
  win.webContents.on('did-create-window', (popup, details) => {
    // 创建后按保存尺寸校正原生外框，不让 Chromium 的窗口特性换算累积偏差。
    const bounds = requestedBounds.get(details.frameName)
    requestedBounds.delete(details.frameName)
    if (bounds && Object.keys(bounds).length) popup.setBounds(bounds)
    require('./window-restore').ensureWindowVisible(popup, screen)
    popup.setMenu(null)
    popup.webContents.on('will-navigate', event => event.preventDefault())
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    let moving = false
    // Windows 原生标题栏拖动完成时，将落点交给主界面检查所属 Shell。
    popup.on('will-move', () => { moving = true })
    popup.on('moved', () => {
      if (!moving || win.isDestroyed()) return
      moving = false
      if (!win.isVisible() || win.isMinimized()) return
      win.webContents.send('terminal-popout-moved', { id: details.frameName.slice('bettershell-console-'.length), point: screen.getCursorScreenPoint(), contentBounds: win.getContentBounds(), zoom: win.webContents.getZoomFactor() })
    })
  })
}

// 合回终端时恢复主窗口，当前 Shell 的选择由主界面完成。
exports.focusTerminalOwner = function () {
  const win = globalState.get('win')
  if (win && !win.isDestroyed()) showMainWindow(win, screen)
}
