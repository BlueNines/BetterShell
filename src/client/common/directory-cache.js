// 每个文件面板独立缓存；时间、目录数、条目数和估算字节数共同限制内存。
export default class DirectoryCache {
  // loader 只读取一层目录，不执行递归扫描。
  constructor (loader, { freshFor = 5000, retainFor = 30000, maxDirectories = 16, maxFiles = 12000, maxBytes = 4 * 1024 * 1024, now = Date.now } = {}) {
    this.loader = loader
    Object.assign(this, { freshFor, retainFor, maxDirectories, maxFiles, maxBytes, now })
    this.entries = new Map()
    this.pending = new Map()
    this.files = 0
    this.bytes = 0
    this.disposed = false
  }

  // 立即返回近期快照并更新 LRU，不等待网络；过期快照立即释放。
  peek (path) {
    const entry = this.entries.get(path)
    if (!entry) return null
    if (this.now() - entry.time > this.retainFor) { this.remove(path); return null }
    this.entries.delete(path)
    this.entries.set(path, entry)
    return entry
  }

  // 同一路径共享一次读取；失效或卸载前开始的请求不会重新写入缓存。
  read (path) {
    if (this.disposed) return Promise.reject(new Error('目录面板已关闭'))
    const cached = this.peek(path)
    if (cached && this.now() - cached.time <= this.freshFor) return Promise.resolve(cached.list)
    if (this.pending.has(path)) return this.pending.get(path)
    const request = Promise.resolve().then(() => this.loader(path)).then(list => {
      if (!this.disposed && this.pending.get(path) === request) this.remember(path, list)
      return list
    }).finally(() => { if (this.pending.get(path) === request) this.pending.delete(path) })
    this.pending.set(path, request)
    return request
  }

  // 大目录仍可显示，但超过预算的结果不进入缓存。
  remember (path, list) {
    this.remove(path)
    let bytes = path.length * 2
    for (const file of list) bytes += 160 + 2 * ((file.name?.length || 0) + (file.path?.length || 0) + (file.id?.length || 0))
    if (list.length > this.maxFiles || bytes > this.maxBytes) return
    this.entries.set(path, { list, bytes, time: this.now() })
    this.files += list.length
    this.bytes += bytes
    while (this.entries.size > this.maxDirectories || this.files > this.maxFiles || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value)
  }

  // 删除单个快照时同步扣除预算，避免缓存计数随导航累积。
  remove (path) {
    const entry = this.entries.get(path)
    if (!entry) return
    this.files -= entry.list.length
    this.bytes -= entry.bytes
    this.entries.delete(path)
  }

  // 刷新、改名、删除后移除该路径及子目录，同时隔离旧请求的结果。
  invalidate (path, descendants = true) {
    const separator = path.includes('\\') ? '\\' : '/'
    const prefix = path.endsWith(separator) ? path : path + separator
    for (const key of new Set([...this.entries.keys(), ...this.pending.keys()])) {
      if (key === path || (descendants && key.startsWith(prefix))) { this.remove(key); this.pending.delete(key) }
    }
  }

  // 重连时清空快照和请求身份，随后仍能继续使用这个缓存。
  clear () {
    this.entries.clear()
    this.pending.clear()
    this.files = 0
    this.bytes = 0
  }

  // 关闭面板后释放所有缓存，迟到响应只完成自己的 Promise。
  dispose () {
    this.disposed = true
    this.clear()
  }
}
