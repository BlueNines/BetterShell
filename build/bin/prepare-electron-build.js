const { cp } = require('shelljs')
const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')

// 打包时同步准备独立的中文编辑器资源，缺失时自动下载已锁定官方版本。
execFileSync(process.execPath, [resolve(__dirname, 'prepare-notepad.js')], { stdio: 'inherit' })
cp('-r', 'build/electron-builder.json', './')
