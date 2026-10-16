import { useState } from 'react'
import { auto } from 'manate/react'
import { Button, Input, Popover } from 'antd'
import { EditOutlined, PlusOutlined, SearchOutlined, LaptopOutlined } from '@ant-design/icons'

// 顶部服务器按钮和标签栏加号共用同一份可搜索的连接列表。
const ConnectionList = auto(function ConnectionList ({ store, close }) {
  const [search, setSearch] = useState('')
  const keyword = search.trim().toLowerCase()
  const servers = store.bookmarks.filter(item => (item.type === 'ssh' || item.host) && (!keyword || `${item.title} ${item.host} ${item.username}`.toLowerCase().includes(keyword)))

  // 关闭选择器后打开所选的已保存连接。
  function connect (item) {
    close()
    store.onSelectBookmark(item.id)
  }

  // 编辑现有配置时关闭浮层，避免挡住编辑窗口。
  function edit (item) {
    close()
    store.openBookmarkEdit(item)
  }

  // 新建服务器和本机终端都保留在列表底部。
  function create (local) {
    close()
    if (local) store.addTab({ type: 'local', title: '本机终端', pane: 'terminal' })
    else store.onNewSsh()
  }

  return (
    <div className='personal-connections'>
      <div className='personal-popover-title'>选择服务器<span>{store.bookmarks.length} 个连接</span></div>
      <Input aria-label='搜索已保存的服务器' placeholder='搜索名称、地址或用户名' prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} allowClear />
      <div className='personal-connection-list'>
        {servers.map(item => (
          <div className='personal-connection-row' key={item.id}>
            <button className='personal-connection-name' onClick={() => connect(item)}><strong>{item.title || item.host}</strong><small>{item.username}@{item.host}:{item.port || 22}</small></button>
            <Button type='text' size='small' aria-label={'编辑 ' + item.title} icon={<EditOutlined />} onClick={() => edit(item)} />
          </div>
        ))}
        {!servers.length && <div className='personal-empty-note'>{keyword ? '没有匹配的服务器' : '还没有保存的服务器'}</div>}
      </div>
      <div className='personal-connection-actions'><Button icon={<PlusOutlined />} onClick={() => create(false)}>新建连接</Button><Button type='text' icon={<LaptopOutlined />} onClick={() => create(true)}>本机终端</Button></div>
    </div>
  )
})

// 在触发按钮旁展示连接选择器，选择完成后立即收起。
export default function ConnectionPicker ({ store, children, placement = 'bottomLeft' }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen} content={<ConnectionList store={store} close={() => setOpen(false)} />} trigger='click' placement={placement} destroyOnHidden>{children}</Popover>
}
