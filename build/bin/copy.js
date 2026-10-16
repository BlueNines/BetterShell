const { resolve } = require('path')
const { cp } = require('shelljs')
const { cpSync, existsSync, readFileSync, writeFileSync } = require('fs')

// 编译时同时同步主进程代码，避免界面已更新而启动逻辑仍是旧版本。
cpSync(resolve(__dirname, '../../src/app'), resolve(__dirname, '../../work/app'), { recursive: true })
// 同步构建版本，源码运行和打包后的界面都显示当前工程版本。
const manifestPath = resolve(__dirname, '../../work/app/package.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = require('../../package.json').version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}
const from0 = resolve(
  __dirname,
  '../../node_modules/electerm-icons/icons'
)
const to2 = resolve(
  __dirname,
  '../../work/app/assets/icons'
)
const arr = [
  {
    from: from0,
    to: to2
  }
]

for (const obj of arr) {
  const {
    file, from, to
  } = obj
  if (file) {
    cp(from, to)
  } else {
    cp('-r', from, to)
  }
}
