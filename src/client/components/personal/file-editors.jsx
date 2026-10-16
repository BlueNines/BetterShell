import { auto } from 'manate/react'
import { Alert, Button, Drawer, Modal, Space, Tag } from 'antd'
import { syncExternalFile, stopExternalFile } from '../../common/external-editor'

const labels = { ready: '编辑中', syncing: '正在同步', saved: '已同步', error: '同步失败', disconnected: '已断开', local: '本地编辑' }

// 简单的编辑文件列表显示每个文件的保存结果，不再显示内置编辑器。
export default auto(function FileEditors ({ store }) {
  const [modal, context] = Modal.useModal()

  // 只有服务器内容冲突时由用户明确选择覆盖，本地修改始终保留。
  function overwrite (file) {
    modal.confirm({ title: '用本地文件覆盖服务器版本？', content: file.remotePath, okText: '覆盖并同步', cancelText: '取消', onOk: () => syncExternalFile(file, true) })
  }

  return (
    <>
      {context}
      <Drawer title='Notepad++ 文件编辑' open={store.externalEditorOpen} onClose={() => { store.externalEditorOpen = false }} size={620}>
        <Alert title='在 Notepad++ 中按 Ctrl+S 保存，远程文件会自动同步。请在退出 BetterShell 或关闭对应 Shell 前完成保存。' type='info' showIcon />
        {!store.externalEditorFiles.length && <p className='personal-empty-note'>右键文件选择「用 Notepad++ 编辑」，支持同时打开多个文件。</p>}
        {store.externalEditorFiles.map(file => (
          <div className='personal-file-editor' key={file.key}>
            <div className='personal-file-editor-title'><strong>{file.name || file.remotePath}</strong><Tag color={file.state === 'error' ? 'error' : file.state === 'saved' ? 'success' : 'default'}>{labels[file.state]}</Tag></div>
            <div className='personal-file-editor-path'>{file.title} · {file.remotePath || file.localPath}</div>
            {file.error && <div className='personal-file-editor-error'>{file.error}</div>}
            <Space size='small'><Button size='small' onClick={() => window.pre.runGlobalAsync('openNotepadFiles', [file.localPath]).catch(store.onError)}>在 Notepad++ 打开</Button>{file.state === 'error' && <><Button size='small' onClick={() => syncExternalFile(file).catch(store.onError)}>重试同步</Button><Button size='small' danger onClick={() => overwrite(file)}>覆盖服务器</Button></>}<Button size='small' type='text' disabled={file.state === 'syncing'} onClick={() => stopExternalFile(file).catch(store.onError)}>{file.remotePath ? '停止同步' : '移出列表'}</Button></Space>
          </div>
        ))}
      </Drawer>
    </>
  )
})
