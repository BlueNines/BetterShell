const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 模拟编译命令退出码，不调用工具或改动实际编译产物。
function runBuild (file, failCommand) {
  const commands = []
  const stopped = { code: null }
  const context = { __dirname: path.resolve(__dirname, '../../../build/bin'), Date, process: { exitCode: 0, exit (code) { stopped.code = code; throw stopped } }, require (name) { return name === 'shelljs' ? { echo () {}, cd () {}, exec (command) { commands.push(command); return { code: command === failCommand ? 7 : 0 } } } : require(name) } }
  try { vm.runInNewContext(fs.readFileSync(path.join(context.__dirname, file), 'utf8'), context) } catch (error) { if (error !== stopped) throw error }
  return { commands, exit: stopped.code, exitCode: context.process.exitCode }
}

// 编译失败后绝不进入复制和更新界面入口的步骤。
test('build stops before copying stale frontend files', () => {
  const result = runBuild('build.js', 'npm run vite-build')
  assert.equal(result.exit, 7)
  assert.deepEqual(result.commands, ['npm run vite-build'])
})

// Vite 子脚本必须把失败码传给调用者。
test('vite build propagates the frontend failure exit code', () => {
  assert.equal(runBuild('vite-build.js', 'npm run build').exitCode, 7)
})

// 成功时仍完成正常的编译、复制和 HTML 入口生成。
test('successful builds run all steps', () => {
  const result = runBuild('build.js', null)
  assert.equal(result.exit, null)
  assert.deepEqual(result.commands, ['npm run vite-build', 'node ./build/bin/copy.js', 'node ./build/bin/pug.js'])
})
