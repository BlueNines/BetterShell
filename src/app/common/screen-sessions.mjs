// GNU screen 清单使用制表符分隔会话名、时间和状态，保留中文及空格名称。
export function parseScreenSessions (text) {
  const result = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const fields = line.trim().split(/\t+/)
    const id = fields[0]?.trim()
    if (!/^\d+\.[^\r\n\0]+$/.test(id || '') || id.length > 256) continue
    const status = line.match(/\(([^()]*)\)\s*$/)?.[1] || ''
    if (/dead/i.test(status)) continue
    result.push({ id, name: id.slice(id.indexOf('.') + 1), attached: /attached/i.test(status) && !/detached/i.test(status) })
  }
  return result.slice(0, 128)
}

// 共享附着并强制适配当前终端，避免 screen 恢复旧列数后留下右侧分界线。
export function screenAttachCommand (id) {
  if (typeof id !== 'string' || !/^\d+\.[^\r\n\0]+$/.test(id) || id.length > 256) throw new Error('screen 会话标识无效')
  return "exec screen -A -x '" + id.replace(/'/g, "'\\''") + "'"
}
