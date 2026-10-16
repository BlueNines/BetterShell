import { useRef, useState } from 'react'
import { Button, Space } from 'antd'
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import ConsoleGroup from './console-group'

// screen 顶层标签只占据整个终端区，不挂载目录、MySQL 或服务器监控。
export default function ScreenSession (props) {
  const { tab, width, height, computeHeight } = props
  const console = useRef(null)
  const [detached, setDetached] = useState(false)
  return (
    <div className='personal-screen-session'>
      <div className='personal-session-control'><span title={'screen · ' + tab.screenSession}>screen · {tab.screenSession}</span><Space size={4}><Button size='small' type='text' icon={<ReloadOutlined />} onClick={() => window.store.reloadTab(tab.id)}>重连</Button><Button size='small' type='text' icon={<ExportOutlined />} aria-label={detached ? '合回控制台' : '弹出控制台窗口'} onClick={() => console.current?.togglePopout()} disabled={!detached && tab.status !== 'success'}>{detached ? '合回顶部标签' : '独立窗口'}</Button></Space></div>
      <ConsoleGroup {...props} ref={console} width={width} height={computeHeight(height)} themeConfig={window.store.getThemeConfig()} sessionOptions={null} sftpPathFollowSsh={false} setCwd={() => {}} pane='terminal' config={{ ...props.config, showCmdSuggestions: false, autoReconnectTerminal: false }} onDetachedChange={setDetached} logName={'screen-' + tab.id} />
    </div>
  )
}
