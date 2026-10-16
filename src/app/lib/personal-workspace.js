const { dbAction } = require('./db')
const globalState = require('./glob-state')

const WORKSPACE_ID = 'lastWorkspace'

// 工作区只保存在本机加密库，不包含进程或网络连接对象。
exports.savePersonalWorkspace = async function (snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tabs) || snapshot.tabs.length > 200) throw new Error('工作区内容无效')
  const text = JSON.stringify(snapshot)
  if (Buffer.byteLength(text, 'utf8') > 32 * 1024 * 1024) throw new Error('工作区超过 32 MiB，请减少查询结果或标签页')
  await dbAction('personalWorkspace', 'insert', { _id: WORKSPACE_ID, snapshot, savedAt: Date.now() })
  return { saved: true }
}

// 启动时只读取快照，是否重新连接由对应标签页恢复逻辑决定。
exports.loadPersonalWorkspace = async function () {
  const row = await dbAction('personalWorkspace', 'findOne', { _id: WORKSPACE_ID })
  return row?.snapshot || null
}

// 渲染器完成初始化后，正常关闭窗口必须等待最后一次工作区写入。
exports.enableWorkspacePersistence = function () {
  globalState.set('workspacePersistenceReady', true)
}

// 只有保存完成才允许第二次关闭事件退出进程。
exports.finishWorkspaceClose = function () {
  globalState.set('workspaceCloseReady', true)
  globalState.get('win')?.close()
}

// 保存失败时允许用户继续使用窗口，保留之前的磁盘快照。
exports.cancelWorkspaceClose = function () {
  globalState.set('workspaceClosePending', false)
}
