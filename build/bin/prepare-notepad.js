const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const VERSION = '8.9.8.1'
const COMMIT = 'dd40fe45598791e9aa38f3aeb200e10fb3d6338a'
const SHA256 = 'beddf5548e75c97930d1575ba1c7d113e6e2b33d0a200310e734ca08e225f414'
const directory = path.resolve(__dirname, '../../vendor/notepad-plus-plus')

// 下载固定的官方版本，HTTP 失败时停止构建，不使用未知镜像。
async function download (url, target) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Notepad++ 下载失败：' + response.status)
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(target, buffer)
  return buffer
}

// Windows 构建准备官方便携程序、简体中文语言、许可证和对应完整源代码。
async function main () {
  await fs.mkdir(directory, { recursive: true })
  try { await fs.access(path.join(directory, 'notepad++.exe')) } catch {
    const cache = path.resolve(__dirname, '../../temp/build-tools/notepad-plus-plus')
    await fs.mkdir(cache, { recursive: true })
    const archiveName = `npp.${VERSION}.portable.x64.zip`
    const archive = path.join(cache, archiveName)
    let buffer
    try { buffer = await fs.readFile(archive) } catch { buffer = await download(`https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v${VERSION}/${archiveName}`, archive) }
    if (createHash('sha256').update(buffer).digest('hex') !== SHA256) throw new Error('Notepad++ 官方 SHA-256 校验失败')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BETTERSHELL_NPP_ARCHIVE -DestinationPath $env:BETTERSHELL_NPP_DEST -Force'], { windowsHide: true, env: { ...process.env, BETTERSHELL_NPP_ARCHIVE: archive, BETTERSHELL_NPP_DEST: directory }, stdio: 'inherit' })
  }
  const source = path.join(directory, `notepad-plus-plus-${VERSION}-source.zip`)
  try { await fs.access(source) } catch { await download(`https://codeload.github.com/notepad-plus-plus/notepad-plus-plus/zip/${COMMIT}`, source) }
  await fs.access(path.join(directory, 'localization/chineseSimplified.xml'))
  const notice = `# Notepad++ ${VERSION}\n\nCopyright (C) Don HO and contributors.\n\nNotepad++ is a separate program distributed under GNU GPL version 3. See license.txt.\nThe executable and official Simplified Chinese localization are unmodified.\nOptional plugins and the updater are not included in BetterShell packages.\n\nSource: https://github.com/notepad-plus-plus/notepad-plus-plus/tree/${COMMIT}\nCorresponding source is included in notepad-plus-plus-${VERSION}-source.zip.\nOfficial portable archive SHA-256: ${SHA256}\n\nBetterShell launches Notepad++ as a separate process and uses its public file-opening message.\n`
  await fs.writeFile(path.join(directory, 'NOTICE.md'), notice, 'utf8')
  console.log('Notepad++ ' + VERSION + ' ready (Simplified Chinese)')
}

// 任一资源缺失或校验失败都使打包失败，避免发布打不开文件的版本。
main().catch(error => { console.error(error.message); process.exitCode = 1 })
