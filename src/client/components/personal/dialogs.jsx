import { auto } from 'manate/react'
import { useEffect } from 'react'
import { Modal, Form, Input, InputNumber, Select, Button, Switch, Popconfirm } from 'antd'
import uid from '../../common/uid'
import { defaultBookmarkGroupId } from '../../common/constants'
import { defaultThemeId, defaultThemeLightId } from '../../common/theme-defaults'

// 将简洁连接表单保存到原有凭据存储，不另建一套账户系统。
export default auto(function PersonalDialogs ({ store }) {
  const [form] = Form.useForm()
  const item = store.bookmarks.find(item => item.id === store.personalBookmarkId)
  const opened = store.personalDialog === 'connection'
  const authType = Form.useWatch('authType', form)
  useEffect(() => {
    if (opened) {
      form.resetFields()
      form.setFieldsValue({ port: 22, username: 'root', authType: 'password', ...item })
    }
  }, [opened, item?.id])

  // 验证必填项并保存；用户选择连接时立即打开会话。
  async function saveConnection (connect) {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const previous = { ...item }
    for (const name of ['password', 'privateKey', 'passphrase']) delete previous[name]
    const { password, privateKey, passphrase, ...settings } = values
    const credentials = settings.authType === 'privateKey' ? { privateKey, passphrase } : { password }
    const connection = { ...previous, ...settings, ...credentials, host: settings.host.trim(), username: settings.username.trim(), id: item?.id || uid(), type: 'ssh', enableSsh: true, enableSftp: true, encode: 'utf-8', sshSftpSplitView: true }
    if (item) store.editItem(item.id, connection, 'bookmarks')
    else {
      store.addItem(connection, 'bookmarks')
      const group = store.bookmarkGroups.find(group => group.id === defaultBookmarkGroupId)
      if (group) store.editBookmarkGroup(group.id, { bookmarkIds: [...(group.bookmarkIds || []), connection.id] })
    }
    store.personalDialog = ''
    if (connect) store.onSelectBookmark(connection.id)
  }

  // 选择私钥文件，仅通过已有受控文件桥读取 UTF-8 文本。
  async function chooseKey () {
    const result = await window.api.openDialog({ properties: ['openFile'] })
    const filePath = result?.[0]
    if (filePath) form.setFieldsValue({ privateKey: await window.fs.readFile(filePath) })
  }

  // 删除选中的连接收藏，不关闭已经打开的会话。
  function deleteConnection () {
    if (item) store.delItem({ id: item.id }, 'bookmarks')
    store.personalDialog = ''
  }

  const config = store.config
  return (
    <>
      <Modal title={item ? '编辑服务器' : '添加服务器'} open={opened} onCancel={() => { store.personalDialog = '' }} width={510} footer={<><span className='personal-dialog-delete'>{item && <Popconfirm title='删除这个连接收藏？' onConfirm={deleteConnection}><Button danger type='text'>删除连接</Button></Popconfirm>}</span><Button onClick={() => { store.personalDialog = '' }}>取消</Button><Button onClick={() => saveConnection(false)}>保存</Button><Button type='primary' onClick={() => saveConnection(true)}>保存并连接</Button></>}>
        <Form form={form} layout='vertical' requiredMark={false}>
          <Form.Item label='连接名称' name='title' rules={[{ required: true, whitespace: true, message: '请输入连接名称' }]}><Input placeholder='例如：我的服务器' maxLength={80} /></Form.Item>
          <div className='personal-form-row'><Form.Item label='服务器地址' name='host' rules={[{ required: true, whitespace: true, message: '请输入服务器地址' }]}><Input placeholder='IP 地址或域名' /></Form.Item><Form.Item label='端口' name='port'><InputNumber min={1} max={65535} /></Form.Item></div>
          <div className='personal-form-row'><Form.Item label='用户名' name='username' rules={[{ required: true, whitespace: true, message: '请输入用户名' }]}><Input autoComplete='off' /></Form.Item><Form.Item label='认证方式' name='authType'><Select options={[{ value: 'password', label: '密码' }, { value: 'privateKey', label: 'SSH 私钥' }]} /></Form.Item></div>
          {authType === 'privateKey' ? <><Form.Item label={<span>私钥 <Button size='small' type='link' onClick={chooseKey}>选择文件</Button></span>} name='privateKey' rules={[{ required: true, message: '请选择或粘贴私钥' }]}><Input.TextArea rows={4} placeholder='粘贴 PEM / OpenSSH 私钥' /></Form.Item><Form.Item label='私钥口令（可选）' name='passphrase'><Input.Password autoComplete='new-password' /></Form.Item></> : <Form.Item label='密码' name='password'><Input.Password autoComplete='new-password' placeholder='可留空，在连接时输入' /></Form.Item>}
          <Form.Item label='初始目录（可选）' name='startDirectory'><Input placeholder='/home/你的用户名' /></Form.Item>
        </Form>
      </Modal>
      <Modal title='基本设置' open={store.personalDialog === 'preferences'} onCancel={() => { store.personalDialog = '' }} footer={<Button type='primary' onClick={() => { store.personalDialog = '' }}>完成</Button>} width={440}>
        <div className='personal-setting-row'><span>界面主题</span><Select aria-label='界面主题' value={config.personalUiMode || 'dark'} onChange={personalUiMode => store.setConfig({ personalUiMode })} options={[{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]} /></div>
        <div className='personal-setting-row'><span>终端字号</span><InputNumber min={10} max={28} value={config.fontSize} onChange={value => { if (value) store.setConfig({ fontSize: value }) }} /></div>
        <div className='personal-setting-row'><span>终端配色</span><Select value={config.theme || defaultThemeId} onChange={theme => store.setConfig({ theme })} options={[{ value: defaultThemeId, label: '深色' }, { value: defaultThemeLightId, label: '浅色' }]} /></div>
        <div className='personal-setting-row'><span>本机默认终端</span><Select value={(config.execWindows || '').includes('cmd.exe') ? 'cmd' : 'powershell'} onChange={value => store.setConfig({ execWindows: value === 'cmd' ? 'System32/cmd.exe' : 'System32/WindowsPowerShell/v1.0/powershell.exe' })} options={[{ value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'CMD' }]} /></div>
        <div className='personal-setting-row'><span>显示隐藏文件</span><Switch checked={config.showHiddenFilesOnSftpStart} onChange={value => store.setConfig({ showHiddenFilesOnSftpStart: value })} /></div>
        <div className='personal-setting-row'><span>断线恢复终端内容</span><Switch checked={config.restoreTerminalSessionOnReload} onChange={value => store.setConfig({ restoreTerminalSessionOnReload: value })} /></div>
        <p className='personal-empty-note'>设置自动保存。默认终端和隐藏文件设置在新会话中生效。</p>
      </Modal>
    </>
  )
})
