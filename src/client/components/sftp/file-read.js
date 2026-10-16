/**
 * file info related functions
 */

import generate from '../../common/uid'
import { isWin } from '../../common/constants'

export const getFileExt = fileName => {
  if (/^\\\\(?:wsl\$|wsl\.localhost)\\/.test(fileName)) {
    return {
      base: fileName,
      ext: ''
    }
  }
  const sep = '.'
  const arr = fileName.split(sep)
  const len = arr.length
  if (len === 1) {
    return {
      base: fileName,
      ext: ''
    }
  }
  return {
    base: arr.slice(0, len - 1).join(sep),
    ext: arr[len - 1] || ''
  }
}

const modeDirectoryMask = 0o170000
const modeDirectoryValue = 0o040000

const toIsDirectory = (stat) => {
  if (!stat) {
    return false
  }

  if (typeof stat.isDirectory === 'function') {
    return stat.isDirectory()
  }

  if (typeof stat.isDirectory === 'boolean') {
    return stat.isDirectory
  }

  if (typeof stat.type === 'string') {
    return stat.type === 'd'
  }

  if (typeof stat.type === 'number') {
    return stat.type === 2
  }

  if (typeof stat.mode === 'number') {
    return (stat.mode & modeDirectoryMask) === modeDirectoryValue
  }

  return false
}

const toIsSymbolicLink = (stat) => {
  if (!stat) {
    return false
  }

  if (typeof stat.isSymbolicLink === 'function') {
    return stat.isSymbolicLink()
  }

  if (typeof stat.isSymbolicLink === 'boolean') {
    return stat.isSymbolicLink
  }

  if (typeof stat.type === 'string') {
    return stat.type === 'l'
  }

  if (typeof stat.type === 'number') {
    return stat.type === 3
  }

  return false
}

export const getFolderFromFilePath = (filePath, isRemote) => {
  const sep = isRemote ? '/' : window.pre.sep
  const arr = filePath.split(sep)
  const len = arr.length
  const isWinDisk = isWin && filePath.endsWith(sep)
  const isWslRoot = isWin && /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+$/.test(filePath.replace(/\\$/, ''))
  const path = (isWinDisk || isWslRoot)
    ? '/'
    : arr.slice(0, len - 1).join(sep)
  const name = isWinDisk
    ? filePath.replace(sep, '')
    : isWslRoot
      ? filePath
      : arr[len - 1]

  return {
    path,
    name,
    ...getFileExt(name)
  }
}

function toMs (ms, date) {
  const n = Number(ms)
  if (Number.isFinite(n)) return n
  const d = Number(date)
  return Number.isFinite(d) ? d : 0
}

export const getLocalFileInfo = async (filePath) => {
  const stat = await window.fs.lstatAsync(filePath)
  const symbolic = toIsSymbolicLink(stat)
  const statr = symbolic ? await window.fs.statAsync(filePath) : stat
  return {
    size: stat.size,
    accessTime: toMs(stat.atimeMs, stat.atime),
    modifyTime: toMs(stat.mtimeMs, stat.mtime),
    mode: stat.mode,
    owner: stat.uid,
    group: stat.gid,
    type: 'local',
    ...getFolderFromFilePath(filePath, false),
    id: generate(),
    isDirectory: toIsDirectory(statr),
    isSymbolicLink: symbolic
  }
}

// 普通目录只请求一次完整属性列表，Windows 虚拟根目录继续沿用磁盘枚举。
export async function getLocalDirectoryInfo (folder) {
  if (folder !== '/' && window.fs.readDirectoryAsync) {
    const entries = await window.fs.readDirectoryAsync(/^[a-z]:$/i.test(folder) ? folder + '\\' : folder)
    return entries.map(file => ({ ...file, ...getFileExt(file.name), path: folder, type: 'local', id: generate() }))
  }
  const names = await window.fs.readdirAsync(folder)
  const entries = await Promise.all(names.map(name => getLocalFileInfo(folder === '/' && /^[a-z]:$/i.test(name) ? name + '\\' : window.pre.resolve(folder, name)).catch(() => null)))
  return entries.filter(Boolean)
}

export const getRemoteFileInfo = async (sftp, filePath) => {
  const stat = await sftp.stat(filePath)
  return {
    size: stat.size,
    accessTime: stat.atime,
    modifyTime: stat.mtime,
    mode: stat.mode,
    group: stat.gid,
    owner: stat.uid,
    type: 'remote',
    ...getFolderFromFilePath(filePath, true),
    id: generate(),
    isDirectory: toIsDirectory(stat)
  }
}
