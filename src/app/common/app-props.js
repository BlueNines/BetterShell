/**
 * app path
 */
const { app } = require('electron')
const { resolve, dirname } = require('path')
const constants = require('./runtime-constants')
const installSrc = require('../lib/install-src')

// 获取当前应用目录，支持个人版独立的可执行文件名称。
function getDataPath () {
  const defaultValue = {
    appPath: app.getPath('appData'),
    isPortable: false
  }
  if (!constants.isWin) {
    return defaultValue
  }
  const exePath = dirname(app.getPath('exe'))
  const p = exePath + '\\' + 'electerm'
  if (
    installSrc === 'win-x64-portable.tar.gz' ||
    require('fs').existsSync(
      p
    )
  ) {
    return {
      appPath: exePath,
      exePath,
      isPortable: true
    }
  }
  return {
    ...defaultValue,
    exePath
  }
}

module.exports = {
  ...getDataPath(),
  // 自定义 SSH 密钥目录同时用于主进程和服务器的主机密钥校验。
  sshKeysPath: process.env.sshKeysPath || resolve(
    app.getPath('home'),
    '.ssh'
  ),
  ...constants
}
