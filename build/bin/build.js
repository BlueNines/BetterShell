/**
 * build
 */

const { exec, echo } = require('shelljs')

echo('start build')

const timeStart = +new Date()

// 任一步失败立即停止，防止旧界面文件被误打包成新版。
function run (command) {
  const result = exec(command)
  if (result.code !== 0) process.exit(result.code)
}

// echo('clean')
// exec('npm run clean')
echo('version file')
echo('js/css file')
run('npm run vite-build')
echo('copy file')
run('node ./build/bin/copy.js')
echo('html file')
run('node ./build/bin/pug.js')

const endTime = +new Date()
echo(`done build in ${(endTime - timeStart) / 1000} s`)
