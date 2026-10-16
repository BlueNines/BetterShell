const fs = require('node:fs/promises')
const { watch } = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { pipeline } = require('node:stream/promises')

const MAX_SIZE = 3000 * 1024

// 比较原始字节，不转换文件编码、BOM 或换行符。
function digest (buffer) { return createHash('sha256').update(buffer).digest('hex') }

// 读取有大小上限的远程文件，按块收集，避免循环复制整个文件。
async function readRemote (sftp, filename) {
  const chunks = []
  let length = 0
  for await (const chunk of sftp.createReadStream(filename)) {
    length += chunk.length
    if (length > MAX_SIZE) throw new Error('远程编辑文件不能超过 3 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, length)
}

// 编辑通道属于 Shell，会话切换目录时不依赖文件行或原 SFTP 列表。
class RemoteEditor {
  // 每个标签共享一个独立 SFTP 通道，每个文件分别监控和串行同步。
  constructor (getSsh, tabId, notify) {
    this.getSsh = getSsh
    this.tabId = tabId
    this.notify = notify
    this.files = new Map()
    this.sftp = null
    this.opening = null
    this.disposed = false
    this.cacheId = randomUUID()
  }

  // 按需打开 SFTP，多个文件同时打开时只创建一个通道。
  async connection () {
    if (this.disposed) throw new Error('文件编辑通道已关闭')
    if (this.sftp) return this.sftp
    if (!this.opening) {
      this.opening = new Promise((resolve, reject) => {
        const ssh = this.getSsh()
        if (!ssh) { reject(new Error('请先连接对应 SSH 服务器')); return }
        ssh.sftp((error, sftp) => {
          if (error) { reject(error); return }
          if (this.disposed) { sftp.end(); reject(new Error('文件编辑通道已关闭')); return }
          this.sftp = sftp
          resolve(sftp)
        })
      }).finally(() => { this.opening = null })
    }
    return this.opening
  }

  // 状态只返回路径与同步结果，不向界面传递整份文件内容。
  status (entry, state, error = '') {
    entry.state = state
    entry.error = error
    const result = { id: entry.id, tabId: this.tabId, remotePath: entry.remotePath, localPath: entry.localPath, state, error, savedAt: entry.savedAt || 0 }
    this.notify(result)
    return result
  }

  // 同一路径重复打开保留缓存中的修改，不重新下载覆盖本地编辑。
  async open ({ remotePath }) {
    if (typeof remotePath !== 'string' || !remotePath || remotePath.includes('\0') || remotePath.length > 4096) throw new Error('远程文件路径无效')
    const existing = this.files.get(remotePath)
    if (existing) return this.status(existing, existing.state, existing.error)
    if (this.files.size >= 64) throw new Error('每个 Shell 最多同时编辑 64 个远程文件')
    const sftp = await this.connection()
    const buffer = await readRemote(sftp, remotePath)
    const id = digest(Buffer.from(remotePath, 'utf8')).slice(0, 24)
    const directory = path.join(process.env.BETTERSHELL_EDITOR_CACHE, this.cacheId, id)
    const filename = path.posix.basename(remotePath).replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').replace(/[. ]+$/, '') || 'file.txt'
    const name = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(filename) ? '_' + filename : filename
    await fs.mkdir(directory, { recursive: true })
    const localPath = path.join(directory, name)
    await fs.writeFile(localPath, buffer)
    const entry = { id, remotePath, localPath, expected: digest(buffer), timer: null, saving: null, pending: false, stopped: false, watcher: null, state: 'ready', error: '' }
    entry.watcher = watch(directory, () => {
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => { entry.timer = null; this.sync(entry).catch(() => {}) }, 400)
    })
    entry.watcher.on('error', error => this.status(entry, 'error', error.message))
    this.files.set(remotePath, entry)
    return this.status(entry, 'ready')
  }

  // 合并连续保存；写入前检查服务器原文件，避免覆盖其他人的修改。
  async sync (entry, force = false) {
    if (entry.stopped || this.disposed) return
    entry.pending = true
    if (entry.saving) return entry.saving
    entry.saving = (async () => {
      while (entry.pending && !entry.stopped && !this.disposed) {
        entry.pending = false
        const stat = await fs.stat(entry.localPath)
        if (stat.size > MAX_SIZE) throw new Error('远程编辑文件不能超过 3 MiB，本地修改已保留')
        const buffer = await fs.readFile(entry.localPath)
        const hash = digest(buffer)
        if (hash === entry.expected) continue
        this.status(entry, 'syncing')
        const sftp = await this.connection()
        const remote = digest(await readRemote(sftp, entry.remotePath))
        if (!force && remote !== entry.expected && remote !== hash) throw new Error('服务器文件已被其他操作修改。本地修改已保留，请比较后决定是否覆盖。')
        if (remote !== hash) await pipeline(require('node:stream').Readable.from([buffer]), sftp.createWriteStream(entry.remotePath, { flags: 'w' }))
        entry.expected = hash
        entry.savedAt = Date.now()
        this.status(entry, 'saved')
        force = false
      }
    })().catch(error => { this.status(entry, 'error', error.message); throw error }).finally(() => { entry.saving = null })
    return entry.saving
  }

  // 停止同步只释放监控，不删除本地缓存或关闭 Notepad++ 中的文件。
  stop (remotePath) {
    const entry = this.files.get(remotePath)
    if (!entry) return
    entry.stopped = true
    clearTimeout(entry.timer)
    entry.watcher.close()
    this.files.delete(remotePath)
  }

  // 正常关窗先同步最后一次已保存内容，失败时保留窗口供用户处理。
  async flush () {
    for (const entry of this.files.values()) {
      clearTimeout(entry.timer)
      entry.timer = null
      await this.sync(entry)
    }
    return { saved: true }
  }

  // 标签关闭或网络断开后释放所有监控和 SFTP 通道，缓存继续保留。
  close () {
    this.disposed = true
    for (const filename of this.files.keys()) this.stop(filename)
    this.sftp?.end()
    this.sftp = null
  }
}

// 只在对应 SSH 服务的认证入口提供远程编辑，不开放任意系统命令。
function registerRemoteEditor (app, verify, getSsh, markConnected) {
  app.ws('/editor/:tabId', (ws, req) => {
    verify(req)
    markConnected()
    const editor = new RemoteEditor(() => getSsh(req.params.tabId), req.params.tabId, entry => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ event: entry }))
    })
    let queue = Promise.resolve()
    ws.on('message', message => {
      queue = queue.catch(() => {}).then(async () => {
        let request
        try {
          request = JSON.parse(message)
          const { action, body = {} } = request
          let data
          if (action === 'open') data = await editor.open(body)
          else if (action === 'sync') {
            const entry = editor.files.get(body.remotePath)
            if (!entry) throw new Error('文件已停止同步')
            await editor.sync(entry, body.force === true)
            data = editor.status(entry, entry.state, entry.error)
          } else if (action === 'stop') editor.stop(body.remotePath)
          else if (action === 'flush') data = await editor.flush()
          else throw new Error('不支持的文件编辑操作')
          if (ws.readyState === 1) ws.send(JSON.stringify({ id: request.id, data }))
        } catch (error) { if (ws.readyState === 1) ws.send(JSON.stringify({ id: request?.id, error: { message: error.message } })) }
      })
    })
    ws.on('error', () => editor.close())
    ws.on('close', () => editor.close())
  })
}

module.exports = { RemoteEditor, registerRemoteEditor }
