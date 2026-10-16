/**
 * on close app
 */

const { dbAction } = require('./db')
const log = require('../common/log')
const globalState = require('./glob-state')

exports.getExitStatus = async () => {
  const res = await dbAction('data', 'findOne', {
    _id: 'exitStatus'
  })
  return res && res.value ? res.value : ''
}

exports.onClose = async function (e) {
  const config = globalState.get('config')
  if (config.confirmBeforeExit && globalState.get('closeAction')) {
    const win = globalState.get('win')
    win?.webContents.send(
      'confirm-exit',
      globalState.get('closeAction')
    )
    globalState.set('closeAction', '')
    return e.preventDefault()
  }
  // 最后一次状态落盘前保留窗口和会话，防止关闭后丢失刚输入的草稿。
  if (globalState.get('workspacePersistenceReady') && !globalState.get('workspaceCloseReady')) {
    e.preventDefault()
    if (!globalState.get('workspaceClosePending')) {
      globalState.set('workspaceClosePending', true)
      globalState.get('win')?.webContents.send('prepare-workspace-close')
    }
    return
  }
  log.debug('Closing app')
  const childPid = globalState.get('childPid')
  childPid && process.kill(childPid)
  globalState.set('serverInited', false)
  process.on('uncaughtException', function () {
    const childPid = globalState.get('childPid')
    childPid && process.kill(childPid)
    process.exit(0)
  })
  log.debug('Child process killed')
  // await dbAction('data', 'update', {
  //   _id: 'exitStatus'
  // }, {
  //   value: 'ok',
  //   _id: 'exitStatus'
  // }, {
  //   upsert: true
  // })
  // await dbAction('data', 'update', {
  //   _id: 'sessions'
  // }, {
  //   value: null,
  //   _id: 'sessions'
  // }, {
  //   upsert: true
  // })
  // log.debug('session saved')
  clearTimeout(globalState.get('timer'))
  globalState.set('win', null)
  const app = globalState.get('app')
  app.quit && app.quit()
}
