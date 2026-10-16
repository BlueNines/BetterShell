import { useEffect, useId, useState } from 'react'
import { Modal, Form, Input, InputNumber, Select, Checkbox, Button } from 'antd'

// 数据库账号与 SSH 账号分开填写；SSH 模式仅复用当前已建立的通道。
export default function DatabaseConnectionDialog ({ open, profile, sshAvailable, busy, onCancel, onSave, onDelete }) {
  const [form] = Form.useForm()
  const formName = useId()
  const [saving, setSaving] = useState(false)
  const mode = Form.useWatch('mode', form)
  const ssl = Form.useWatch('ssl', form)
  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ title: '', mode: sshAvailable ? 'ssh' : 'direct', host: '127.0.0.1', port: 3306, username: 'root', password: '', database: '', ssl: false, sslCa: '', ...profile })
  }, [open])

  // 验证填写内容后由父面板保存，只有点击连接才访问服务器。
  async function save (connect) {
    if (saving || busy) return
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try { await onSave({ ...profile, ...values }, connect) } finally { setSaving(false) }
  }

  // 证书按 UTF-8 读取，随连接配置加密保存在本机。
  async function chooseCertificate () {
    const files = await window.api.openDialog({ properties: ['openFile'], filters: [{ name: 'CA 证书', extensions: ['pem', 'crt', 'cer'] }] })
    if (files?.[0]) form.setFieldsValue({ sslCa: await window.fs.readFile(files[0], 'utf8') })
  }

  return (
    <Modal title={profile?.id ? '编辑 MySQL 连接' : '新建 MySQL 连接'} open={open} width={510} onCancel={onCancel} footer={<>{profile?.id && <Button className='personal-dialog-delete' type='text' danger disabled={busy} onClick={() => onDelete(profile)}>删除连接</Button>}<Button onClick={onCancel}>取消</Button><Button loading={busy || saving} onClick={() => save(false)}>保存</Button><Button type='primary' loading={busy || saving} onClick={() => save(true)}>保存并连接</Button></>}>
      <Form name={'mysql-' + formName} form={form} layout='vertical' requiredMark={false} className='mysql-connection-form'>
        <Form.Item label='数据库连接名称' name='title' rules={[{ required: true, whitespace: true, message: '请输入数据库连接名称' }]}><Input maxLength={100} placeholder='例如：游戏服 MySQL' /></Form.Item>
        <Form.Item label='连接方式' name='mode'><Select options={[{ value: 'ssh', label: '通过当前 SSH 隧道', disabled: !sshAvailable }, { value: 'direct', label: '直接连接数据库' }]} /></Form.Item>
        <div className='personal-form-row'><Form.Item label={mode === 'ssh' ? '数据库地址（服务器内）' : '数据库地址'} name='host' rules={[{ required: true, whitespace: true, message: '请输入数据库地址' }]}><Input placeholder='127.0.0.1' /></Form.Item><Form.Item label='数据库端口' name='port'><InputNumber min={1} max={65535} /></Form.Item></div>
        <div className='personal-form-row'><Form.Item label='数据库用户名' name='username' rules={[{ required: true, whitespace: true, message: '请输入数据库用户名' }]}><Input autoComplete='off' /></Form.Item><Form.Item label='默认数据库（可选）' name='database'><Input autoComplete='off' /></Form.Item></div>
        <Form.Item label='数据库密码' name='password'><Input.Password autoComplete='new-password' /></Form.Item>
        <Form.Item name='ssl' valuePropName='checked'><Checkbox>使用 TLS 加密数据库连接</Checkbox></Form.Item>
        {ssl && <Form.Item label={<span>CA 证书（可选） <Button type='link' size='small' onClick={chooseCertificate}>选择文件</Button></span>} name='sslCa'><Input.TextArea rows={3} placeholder='使用系统信任证书，或粘贴 PEM 格式 CA' /></Form.Item>}
        <p className='personal-empty-note'>{mode === 'ssh' ? '地址从当前 SSH 服务器访问，SSH 登录保持不变。' : '直接从本机访问数据库地址。'}密码加密保存，下次打开可直接选择，无需重填。保存并连接会先保存配置。</p>
      </Form>
    </Modal>
  )
}
