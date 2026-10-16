const { fork } = require('child_process')
const path = require('path')

// Map to store active terminal processes (pid -> {child, port, ws})
const activeTerminals = new Map()

// 让操作系统原子分配端口，多个标签同时恢复不会抢到同一个端口。
async function runSessionServer (type) {
  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env, wsPort: '0', type }
    delete cleanEnv.ELECTRON_RUN_AS_NODE
    const child = fork(path.resolve(__dirname, './session-server.js'), { env: cleanEnv, cwd: process.cwd() })
    const timer = setTimeout(() => { child.kill(); fail(new Error('本地会话服务启动超时')) }, 15000)
    // 启动失败必须返回错误，不能让终端永远停留在正在连接。
    function fail (error) {
      clearTimeout(timer)
      child.removeListener('message', initialized)
      reject(error)
    }
    // 监听成功后返回真实端口，后续 SSH 连接仍然独立并行。
    function initialized (message) {
      if (!message?.serverInited) return
      clearTimeout(timer)
      child.removeListener('message', initialized)
      child.removeListener('error', fail)
      child.removeListener('exit', exited)
      resolve({ child, port: Number(message.port) })
    }
    // 子进程在就绪前退出时立即结束等待。
    function exited () { fail(new Error('本地会话服务在就绪前退出')) }
    child.on('message', initialized)
    child.once('error', fail)
    child.once('exit', exited)
  })
}
async function sendMsgToChildProcess (pid, msg, timeoutMs = 0) {
  const child = typeof pid === 'object' ? pid : activeTerminals.get(pid)?.child
  if (!child) {
    throw new Error(`Terminal with PID ${pid} not found`)
  }

  return new Promise((resolve, reject) => {
    let timer = null
    let settled = false
    const entry = { id: msg.id, settle: null }
    const cleanup = () => {
      child.removeListener('message', responseHandler)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const pending = pendingChildRequests.get(child)
      if (pending) {
        pending.delete(entry)
        if (!pending.size) {
          pendingChildRequests.delete(child)
        }
      }
    }
    const doReject = (err) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(err)
    }
    entry.settle = doReject
    const responseHandler = (response) => {
      if (response && response.id === msg.id) {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (response.error) {
          reject(response.error)
        } else {
          resolve(response.data)
        }
      }
    }

    // Track pending requests per child so a child exit settles them
    // instead of leaving callers hanging forever (see onChildExit).
    let pending = pendingChildRequests.get(child)
    if (!pending) {
      pending = new Set()
      pendingChildRequests.set(child, pending)
    }
    pending.add(entry)

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        doReject(new Error(`Session request "${msg.action}" timed out after ${timeoutMs}ms (session may be dead)`))
      }, timeoutMs)
      if (timer.unref) {
        timer.unref()
      }
    }

    child.on('message', responseHandler)
    try {
      child.send({
        type: 'common',
        data: msg
      })
    } catch (err) {
      doReject(err)
    }
  })
}

// Pending sendMsgToChildProcess entries, keyed by child process.
// A child can die (crash on connection loss, cleanup on disconnect)
// while requests are in flight — reject them instead of hanging.
const pendingChildRequests = new Map()

function onChildExit (child) {
  // Settle in-flight requests first: removing listeners without settling
  // used to leave callers (exec-cmd, run-cmd) hanging forever.
  const pending = pendingChildRequests.get(child)
  if (pending) {
    pendingChildRequests.delete(child)
    for (const entry of pending) {
      try {
        entry.settle(new Error('Session process exited before responding'))
      } catch (_) {
        // ignore settle errors during teardown
      }
    }
  }
  // Remove all pending message listeners to prevent memory leaks
  // if the child exits before responding to sendMsgToChildProcess calls
  child.removeAllListeners('message')
}

exports.terminal = async function (initOptions, ws, uid) {
  // screen 子控制台复用父会话服务，关闭子标签不会终止父服务进程。
  if (initOptions.screenSession && initOptions.screenParentId) {
    const parent = activeTerminals.get(initOptions.screenParentId)
    if (!parent || parent.screenParentId) throw new Error('对应 SSH 会话尚未连接')
    await sendMsgToChildProcess(parent.child, { id: uid, action: 'create-terminal', body: initOptions }, 20000)
    activeTerminals.set(initOptions.uid, { child: parent.child, port: parent.port, ws, screenParentId: initOptions.screenParentId })
    return { pid: initOptions.uid, port: parent.port }
  }
  const type = initOptions.termType || initOptions.type || 'terminal'
  const { child, port } = await runSessionServer(type)
  const pid = initOptions.uid
  const isSsh = ![
    'telnet',
    'serial',
    'local',
    'rdp',
    'vnc',
    'spice',
    'ftp'
  ].includes(type)
  if (isSsh) {
    child.on('message', (m) => {
      const { type, data } = m
      if (type === 'common') {
        ws.s(data)
        ws.once((data) => {
          child.send(data)
        }, data.id)
      }
    })
  }
  child.on('exit', () => {
    onChildExit(child)
    for (const [id, entry] of activeTerminals) if (entry.child === child) activeTerminals.delete(id)
  })
  child.on('message', message => {
    if (message?.terminalClosed && activeTerminals.get(message.terminalClosed)?.child === child) activeTerminals.delete(message.terminalClosed)
  })
  if (type !== 'ftp') {
    try {
      await sendMsgToChildProcess(child, {
        id: uid,
        action: 'create-terminal',
        body: initOptions
      })
    } catch (err) {
      child.kill()
      throw err
    }
  }

  // Kill any existing child process for this pid before overwriting.
  // This can happen on reconnects where a new process is spawned for the same tab id.
  const existingEntry = activeTerminals.get(pid)
  if (existingEntry) {
    existingEntry.child.kill()
    activeTerminals.delete(pid)
  }

  // Store the terminal process in the map
  activeTerminals.set(pid, {
    child,
    port,
    ws
  })

  return {
    pid,
    port
  }
}

exports.testConnection = async function (initOptions, ws, uid) {
  const type = initOptions.termType || initOptions.type || 'terminal'
  const { child } = await runSessionServer(type)

  const isSsh = ![
    'telnet',
    'serial',
    'local',
    'rdp',
    'vnc',
    'spice',
    'ftp'
  ].includes(type)
  if (isSsh && ws) {
    child.on('message', (m) => {
      const { type: msgType, data } = m
      if (msgType === 'common') {
        ws.s(data)
        ws.once((respData) => {
          child.send(respData)
        }, data.id)
      }
    })
  }

  const res = await sendMsgToChildProcess(child, {
    id: uid,
    action: 'test-terminal',
    body: initOptions
  }, 60000)

  child.kill()
  return res
}

/**
 * Get terminal instance by pid
 * @param {string} pid - Process ID of the terminal
 * @returns {object|null} Terminal instance or null if not found
 */
exports.terminals = function (pid) {
  const terminal = activeTerminals.get(pid)
  if (!terminal) {
    return null
  }

  return {
    runCmd: async (cmd, id) => {
      return sendMsgToChildProcess(pid, {
        id,
        action: 'run-cmd',
        body: { cmd, pid }
      })
    },
    execCommand: async (cmd, timeoutMs, id) => {
      // Parent-side backstop: the child bounds the command itself with
      // timeoutMs, so allow it plus a margin for IPC round-trips.
      const parentTimeout = (Number(timeoutMs) > 0 ? Number(timeoutMs) : 120000) + 30000
      return sendMsgToChildProcess(pid, {
        id,
        action: 'exec-cmd',
        body: { cmd, pid, timeoutMs }
      }, parentTimeout)
    },
    resize: (cols, rows, id) => {
      // Fire-and-forget, but bound the pending IPC listener with a timeout
      // so a slow/dead child can not accumulate 'message' handlers on resize
      // floods (fit sends resize on every layout change).
      sendMsgToChildProcess(pid, {
        id,
        action: 'resize-terminal',
        body: { cols, rows, pid }
      }, 10000).catch(() => {})// Ignore errors for resize
    },
    toggleTerminalLog: (id) => {
      sendMsgToChildProcess(pid, {
        id,
        action: 'toggle-terminal-log',
        body: { pid }
      }, 10000).catch(() => {})
    },
    toggleTerminalLogTimestamp: (id) => {
      sendMsgToChildProcess(pid, {
        id,
        action: 'toggle-terminal-log-timestamp',
        body: { pid }
      }, 10000).catch(() => {})
    },
    setTerminalLogPath: (id, logPath) => {
      sendMsgToChildProcess(pid, {
        id,
        action: 'set-terminal-log-path',
        body: { pid, logPath }
      }, 10000).catch(() => {})
    },
    startTerminalLogFile: (id, logFilePath, addTimeStampToTermLog) => {
      sendMsgToChildProcess(pid, {
        id,
        action: 'start-terminal-log-file',
        body: { pid, logFilePath, addTimeStampToTermLog }
      }, 10000).catch(() => {})
    }
  }
}

/**
 * Clean up all active terminals
 */
exports.cleanupTerminals = function () {
  for (const child of new Set([...activeTerminals.values()].map(terminal => terminal.child))) child.kill()
  activeTerminals.clear()
}

// Clean up on process exit
process.on('SIGINT', () => {
  exports.cleanupTerminals()
  process.exit()
})
process.on('SIGTERM', () => {
  exports.cleanupTerminals()
  process.exit()
})
