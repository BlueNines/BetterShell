import uid from './uid'

const clients = new Map()

// 同步状态属于全局文件编辑列表，不依赖已经卸载的目录组件。
function updateFile (item) {
  const { store } = window
  const key = item.tabId + ':' + (item.remotePath || item.localPath)
  const previous = store.externalEditorFiles.find(file => file.key === key)
  const updated = { ...previous, ...item, key }
  store.externalEditorFiles = previous ? store.externalEditorFiles.map(file => file.key === key ? updated : file) : [...store.externalEditorFiles, updated]
}

// 每个 SSH 标签拥有一个轻量文件编辑通道，所有文件各自返回状态。
class EditorClient {
  // 只保存请求和通道引用，不保存文件内容副本。
  constructor (tabId, port) {
    this.tabId = tabId
    this.port = port
    this.socket = null
    this.requests = new Map()
    this.opening = null
  }

  // 连接会话的认证服务，同一标签的并发打开请求共享连接。
  async connect () {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.opening) return this.opening
    const config = window.store.config
    const socket = new WebSocket(`ws://${config.host}:${this.port}/editor/${encodeURIComponent(this.tabId)}?token=${encodeURIComponent(config.tokenElecterm)}`)
    this.socket = socket
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.event) { updateFile(message.event); return }
      const request = this.requests.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      this.requests.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.data)
    }
    socket.onclose = () => this.close()
    this.opening = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('文件编辑通道连接超时')) }, 12000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('无法连接文件编辑服务')) }
    }).finally(() => { this.opening = null })
    return this.opening
  }

  // 所有保存请求有等待上限，失败时保留本地文件供用户继续编辑。
  request (action, body = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('对应 SSH 已断开，本地编辑文件仍然保留'))
    const id = uid()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('文件同步等待超时，本地修改已保留')) }, 60000)
      this.requests.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, action, body }))
    })
  }

  // 关闭标签立即释放通道；编辑列表明确显示此时不能继续同步。
  close () {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.onclose = null
    socket.close()
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new Error('文件编辑通道已关闭，本地修改已保留')) }
    this.requests.clear()
    for (const file of window.store.externalEditorFiles.filter(file => file.tabId === this.tabId && file.remotePath)) updateFile({ ...file, state: 'disconnected', error: 'SSH 已断开，Notepad++ 中的本地文件仍可编辑' })
  }
}

// 本地文件直接交给 Notepad++；远程文件按原字节下载并单独监控保存。
export async function openExternalFiles (tab, files, port) {
  const paths = []
  const errors = []
  for (const file of files.filter(file => !file.isDirectory && !file.isParent && !file.isEmpty)) {
    try {
      if (file.type === 'remote') {
        if (!port || tab.status !== 'success') throw new Error('请先连接对应 SSH 服务器')
        let client = clients.get(tab.id)
        if (!client) { client = new EditorClient(tab.id, port); clients.set(tab.id, client) }
        await client.connect()
        const remotePath = (file.path.endsWith('/') ? file.path : file.path + '/') + file.name
        const item = await client.request('open', { remotePath })
        updateFile({ ...item, title: tab.title, name: file.name })
        paths.push(item.localPath)
      } else {
        const localPath = window.pre.resolve(file.path, file.name)
        updateFile({ tabId: 'local', localPath, name: file.name, title: '本地文件', state: 'local' })
        paths.push(localPath)
      }
    } catch (error) { errors.push(file.name + '：' + error.message) }
  }
  if (paths.length) await window.pre.runGlobalAsync('openNotepadFiles', paths)
  if (errors.length) { window.store.externalEditorOpen = true; throw new Error(errors.join('\n')) }
}

// 关闭应用前等待用户已经在 Notepad++ 保存的修改完成上传。
export async function flushExternalFiles () {
  for (const client of clients.values()) if (client.socket?.readyState === WebSocket.OPEN) await client.request('flush')
}

// 重试失败的文件；是否覆盖冲突必须由编辑列表中的确认操作决定。
export async function syncExternalFile (file, force = false) {
  const client = clients.get(file.tabId)
  if (!client) throw new Error('对应 SSH 已关闭，本地文件仍然保留')
  await client.request('sync', { remotePath: file.remotePath, force })
}

// 用户停止同步时保留 Notepad++ 和缓存，仅移除监控记录。
export async function stopExternalFile (file) {
  const client = clients.get(file.tabId)
  if (file.remotePath && client?.socket?.readyState === WebSocket.OPEN) await client.request('stop', { remotePath: file.remotePath })
  window.store.externalEditorFiles = window.store.externalEditorFiles.filter(item => item.key !== file.key)
}

// 关闭 Shell 后不再保留网络连接与计时器，目录切换不会触发释放。
export function pruneExternalEditors (ids) {
  const keep = new Set(ids)
  for (const [id, client] of clients) if (!keep.has(id)) { clients.delete(id); client.close() }
}
