const fs = require('node:fs/promises')
const path = require('node:path')

// 一次跨进程返回整层目录属性；普通文件只 lstat 一次，链接额外跟随目标。
async function readDirectory (directory) {
  const names = await fs.readdir(directory)
  const rows = new Array(names.length)
  let next = 0
  // 限制文件系统并发，避免大目录同时积压成千上万个属性请求。
  async function worker () {
    while (next < names.length) {
      const index = next++
      const name = names[index]
      try {
        const target = path.join(directory, name)
        const stat = await fs.lstat(target)
        const symbolic = stat.isSymbolicLink()
        const followed = symbolic ? await fs.stat(target).catch(() => null) : stat
        rows[index] = { name, size: stat.size, accessTime: stat.atimeMs, modifyTime: stat.mtimeMs, mode: stat.mode, owner: stat.uid, group: stat.gid, isDirectory: followed?.isDirectory() || false, isSymbolicLink: symbolic }
      } catch { /* 读取期间被移走或不可读取的单个条目不阻塞整个目录。 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, names.length) }, worker))
  return rows.filter(Boolean)
}

module.exports = { readDirectory }
