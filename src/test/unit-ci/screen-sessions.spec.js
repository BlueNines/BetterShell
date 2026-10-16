const { before, test } = require('node:test')
const assert = require('node:assert/strict')

let model

// 使用界面和服务端共用的解析与转义规则。
before(async () => { model = await import('../../app/common/screen-sessions.mjs') })

// 时间字段、中文、空格、附着状态和已失效会话都按 GNU screen 格式解析。
test('screen list keeps session identities and filters dead sockets', () => {
  const text = 'There are screens on:\n\t1234.服务端 主控\t(10/09/2026 12:00:00)\t(Detached)\n\t1235.proxy\t(Attached)\n\t1236.old\t(Dead ???)\n3 Sockets in /run/screen/S-qa.\n'
  assert.deepEqual(model.parseScreenSessions(text), [{ id: '1234.服务端 主控', name: '服务端 主控', attached: false }, { id: '1235.proxy', name: 'proxy', attached: true }])
  assert.deepEqual(model.parseScreenSessions('No Sockets found.'), [])
})

// 会话名中的引号和 shell 元字符不能逃出一个参数，也不使用抢占式附着。
test('screen attachment quotes the full id and uses shared attach', () => {
  assert.equal(model.screenAttachCommand('1234.server'), "exec screen -A -x '1234.server'")
  assert.equal(model.screenAttachCommand("1234.a'; echo injected"), "exec screen -A -x '1234.a'\\''; echo injected'")
  for (const invalid of ['', '-r', 'name', '1234.server\nshutdown', '1234.server\0']) assert.throws(() => model.screenAttachCommand(invalid))
})
