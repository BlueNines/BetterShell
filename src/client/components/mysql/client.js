import uid from '../../common/uid'

// 面板独立的请求通道，密码只在本地连接请求和系统加密存储中使用。
export default class MysqlClient {
  // 生命周期由所在终端标签管理，避免后台连接无限积累。
  constructor (tabId, onEvent) {
    this.tabId = tabId
    this.onEvent = onEvent
    this.socket = null
    this.requests = new Map()
  }

  // SSH 模式访问该会话的服务；直连模式访问主服务。
  async connect (config, port) {
    this.close()
    const settings = window.store.config
    const socket = new WebSocket(`ws://${settings.host}:${port}/mysql/${encodeURIComponent(this.tabId)}?token=${encodeURIComponent(settings.tokenElecterm)}`)
    this.socket = socket
    socket.onmessage = event => {
      if (this.socket !== socket) return
      const message = JSON.parse(event.data)
      if (message.event) { this.onEvent(message.event); return }
      const request = this.requests.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      this.requests.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.data)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.rejectRequests()
      this.onEvent({ type: 'disconnected', message: '数据库连接已断开' })
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('数据库服务连接超时')) }, 12000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('无法连接本地数据库服务')) }
    })
    return this.request('connect', config)
  }

  // 对每个请求设置上限，超时后请求服务器中止正在运行的语句。
  request (action, body = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('数据库连接已关闭'))
    const id = uid()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id)
        this.socket?.send(JSON.stringify({ id: uid(), action: 'cancel', body: {} }))
        reject(new Error('数据库操作等待超时，已请求中止'))
      }, 120000)
      this.requests.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, action, body }))
    })
  }

  // 关闭连接时立即释放尚未完成请求的回调和定时器。
  rejectRequests () {
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('数据库连接已关闭'))
    }
    this.requests.clear()
  }

  // 显式断开或销毁标签页时释放 MySQL 和 SSH 转发连接。
  close () {
    const socket = this.socket
    this.socket = null
    this.rejectRequests()
    socket?.close()
  }
}
