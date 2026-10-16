const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { app } = require('electron')

let editor = null
let opening = Promise.resolve()

// 打包版使用附带的官方便携版，开发版使用同一份已校验文件。
function notepadDirectory () {
  return app.isPackaged ? path.join(process.resourcesPath, 'notepad-plus-plus') : path.resolve(__dirname, '../../../vendor/notepad-plus-plus')
}

// 中文界面和配置放在用户目录，安装到 Program Files 时也可正常保存设置。
async function prepareNotepad () {
  const directory = notepadDirectory()
  const settings = path.join(process.env.DATA_PATH || app.getPath('userData'), 'notepad-plus-plus')
  await fs.mkdir(settings, { recursive: true })
  try { await fs.access(path.join(settings, 'nativeLang.xml')) } catch {
    await fs.copyFile(path.join(directory, 'localization/chineseSimplified.xml'), path.join(settings, 'nativeLang.xml'))
  }
  try { await fs.access(path.join(settings, 'config.xml')) } catch {
    // 编辑器保留官方默认浅色，独立于 BetterShell 和 Windows 的主题。
    await fs.writeFile(path.join(settings, 'config.xml'), '<?xml version="1.0" encoding="UTF-8"?><NotepadPlus><GUIConfigs><GUIConfig name="noUpdate">yes</GUIConfig><GUIConfig name="multiInst" setting="0"/><GUIConfig name="DarkMode" enable="no" enableWindowsMode="no" lightThemeName=""/><GUIConfig name="RememberLastSession">no</GUIConfig></GUIConfigs></NotepadPlus>', 'utf8')
  }
  return { directory, settings }
}

// 不经过 shell 拼接命令，空格、中文与特殊字符文件名作为独立参数传递。
exports.openNotepadFiles = async function (files) {
  if (!Array.isArray(files) || !files.length || files.length > 64 || files.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0'))) throw new Error('编辑文件路径无效')
  for (const file of files) if (!(await fs.stat(file)).isFile()) throw new Error('只能编辑文件')
  const { directory, settings } = await prepareNotepad()
  const executable = path.join(directory, 'notepad++.exe')
  // 打开操作串行，避免两个同时到来的请求各自创建编辑器窗口。
  const task = opening.catch(() => {}).then(async () => {
    if (editor && editor.exitCode === null && editor.signalCode === null) {
      const script = await fs.readFile(path.join(__dirname, 'notepad-window.ps1'), 'utf8')
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, env: { ...process.env, BETTERSHELL_NPP_ID: String(editor.pid), BETTERSHELL_NPP_EXE: executable, BETTERSHELL_NPP_FILES: Buffer.from(JSON.stringify(files), 'utf8').toString('base64') } })
    } else {
      await new Promise((resolve, reject) => {
        const child = spawn(executable, ['-multiInst', '-nosession', '-settingsDir=' + settings, ...files], { cwd: directory, detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => { editor = child; child.unref(); resolve() })
        child.once('exit', () => { if (editor === child) editor = null })
      })
    }
  })
  opening = task
  await task
  return { opened: files.length }
}
