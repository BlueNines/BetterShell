import { auto } from 'manate/react'
import { Button, Popover } from 'antd'
import { PlusOutlined, SettingOutlined, LaptopOutlined, FolderOpenOutlined, EditOutlined } from '@ant-design/icons'
import { pick } from 'lodash-es'
import Tabs from './tabs'
import Sessions from '../session/sessions'
import TermSearch from '../terminal/term-search'
import Monitor from './monitor'
import ConnectionPicker from './connections'
import { refs } from '../common/ref'

const TOOLBAR_HEIGHT = 44
const STATUS_HEIGHT = 25

// 根据窗口宽度安排状态面板、终端和文件区。
export default auto(function PersonalLayout ({ store }) {
  const tab = store.tabs.find(tab => tab.id === store.activeTabId)
  const screenOnly = Boolean(tab?.screenSession)
  const monitorWidth = Math.round(Math.min(272, Math.max(180, store.width * 0.18)))
  const panelWidth = screenOnly ? 0 : monitorWidth
  const width = Math.max(320, store.width - monitorWidth)
  const height = Math.max(260, store.height - TOOLBAR_HEIGHT - STATUS_HEIGHT)
  const config = store.config
  const shared = pick(store, ['fileOperation', 'tabsHeight', 'appPath', 'resolutions', 'fullscreen'])
  const commandHistory = (
    <div className='personal-command-history'>
      <div className='personal-popover-title'>命令历史</div>
      {store.terminalCommandHistory.slice(0, 30).map(item => (
        <button key={item.id || item.cmd} onClick={() => refs.get('term-' + store.activeTabId)?.runQuickCommand(item.cmd, true)}>{item.cmd}</button>
      ))}
      {!store.terminalCommandHistory.length && <div className='personal-empty-note'>执行过的命令会显示在这里</div>}
    </div>
  )
  return (
    <>
      <header className='personal-toolbar'>
        <div className='personal-brand'><span className='personal-brand-mark'>›_</span><strong>BetterShell</strong><span className='personal-version'>个人版 · v{window.pre.packInfo.version}</span></div>
        <div className='personal-toolbar-actions'>
          <ConnectionPicker store={store}><Button icon={<FolderOpenOutlined />} aria-label='服务器' title='服务器'>服务器</Button></ConnectionPicker>
          <Button icon={<PlusOutlined />} aria-label='新建连接' title='新建连接' onClick={() => store.onNewSsh()}>新建连接</Button>
          <Button type='text' icon={<LaptopOutlined />} aria-label='本机终端' title='本机终端' onClick={() => store.addTab({ type: 'local', title: '本机终端', pane: 'terminal' })}>本机终端</Button>
          <Button type='text' icon={<EditOutlined />} aria-label='文件编辑' title={'文件编辑 · ' + store.externalEditorFiles.length + ' 个文件'} onClick={() => { store.externalEditorOpen = true }}>文件编辑{store.externalEditorFiles.length ? ` (${store.externalEditorFiles.length})` : ''}</Button>
          <Button type='text' icon={<SettingOutlined />} aria-label='设置' title='设置' onClick={() => store.openSetting()}>设置</Button>
        </div>
      </header>
      {!screenOnly && <aside className='personal-monitor' style={{ top: TOOLBAR_HEIGHT, bottom: STATUS_HEIGHT, width: panelWidth }}><Monitor tab={tab} /></aside>}
      <div className='personal-session-tabs v1' style={{ left: panelWidth, top: TOOLBAR_HEIGHT, width: store.width - panelWidth, height: 36 }}>
        <Tabs batch={0} layout='c1' tabs={store.tabs} currentBatchTabId={store.activeTabId0} width={width} height={height} config={config} isMobile={false} {...shared} />
      </div>
      <Sessions {...shared} screenWidth={store.width} styles={[{ left: 0, top: 0, width, height }]} sizes={[{ width, height }]} layoutStyle={{ left: 0, top: TOOLBAR_HEIGHT, width: store.width, height }} shellLeft={monitorWidth} layout='c1' config={config} tabs={store.tabs} activeTabId={store.activeTabId} activeTabId0={store.activeTabId0} tabsHeight={36} />
      {!store.tabs.length && <div className='personal-welcome' style={{ left: panelWidth }}><FolderOpenOutlined /><h2>终端和文件，在一个窗口</h2><p>连接服务器后，上方操作终端，下方浏览和编辑文件。</p><ConnectionPicker store={store}><Button type='primary' icon={<FolderOpenOutlined />}>选择服务器</Button></ConnectionPicker><Button type='text' onClick={() => store.addTab({ type: 'local', title: '本机终端', pane: 'terminal' })}>打开本机终端</Button></div>}
      <TermSearch currentTab={tab} config={config} {...pick(store, ['activeTabId', 'termSearchOpen', 'termSearch', 'termSearchOptions', 'termSearchMatchCount', 'termSearchMatchIndex'])} />
      <footer className='personal-status'><span><i className={'personal-status-dot ' + (tab?.status || '')} />{tab?.host ? `${tab.username}@${tab.host}` : tab ? '本机终端' : '就绪'}</span><span className='personal-status-right'><Popover content={commandHistory} trigger='click' placement='topRight'><button>命令历史</button></Popover><span>UTF-8</span><span>{store.fileTransfers.length ? `${store.fileTransfers.length} 个传输任务` : '无传输任务'}</span></span></footer>
    </>
  )
})
