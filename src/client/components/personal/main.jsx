import { auto } from 'manate/react'
import { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import PersonalLayout from './layout'
import PersonalDialogs from './dialogs'
import FileInfoModal from '../sftp/file-info-modal'
import FileCompareModal from '../sftp/file-compare-modal'
import FileEditors from './file-editors'
import UiTheme from '../main/ui-theme'
import ShortcutControl from '../shortcuts/shortcut-control'
import TerminalInteractive from '../terminal/terminal-interactive'
import ConfirmModalStore from '../file-transfer/conflict-resolve'
import TransportsActionStore from '../file-transfer/transports-action-store'
import TransferQueue from '../file-transfer/transfer-queue'
import Remote2RemoteHandlers from '../file-transfer/remote2remote-handlers'
import InputContextMenu from '../common/input-context-menu'
import { NotificationContainer } from '../common/notification'
import TerminalCmdSuggestions from '../terminal/terminal-command-dropdown'
import deepCopy from 'json-deep-copy'
import '../../common/fs.js'
import '../main/wrapper.styl'
import './personal.styl'

// 启动个人版核心界面，保留连接、终端和文件传输所需的事件。
export default auto(function Main ({ store }) {
  useEffect(() => {
    const { ipcOnEvent } = window.pre
    const events = {
      'new-ssh': store.onNewSsh,
      openSettings: store.openSetting,
      'add-tab-from-command-line': store.addTabFromCommandLine,
      'open-tab': (event, parsed) => store.ipcOpenTab(parsed),
      selectall: store.selectall,
      focused: store.focus,
      blur: store.onBlur,
      'confirm-exit': store.beforeExitApp,
      'prepare-workspace-close': store.prepareWorkspaceClose
    }
    for (const [name, handler] of Object.entries(events)) ipcOnEvent(name, handler)
    window.addEventListener('resize', store.onResize)
    window.addEventListener('offline', store.setOffline)
    store.initData().then(store.onResize)
    return () => {
      window.removeEventListener('resize', store.onResize)
      window.removeEventListener('offline', store.setOffline)
    }
  }, [])
  const config = store.config
  const dark = config.personalUiMode !== 'light'
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    window.pre.runGlobalAsync('setNativeUiTheme', dark ? 'dark' : 'light').catch(store.onError)
  }, [dark])
  const transfers = deepCopy(store.fileTransfers)
  return (
    <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: dark ? '#7daaff' : '#3976d2', colorBgBase: dark ? '#151c27' : '#ffffff', colorTextBase: dark ? '#c7d2e2' : '#253247', borderRadius: 6, fontSize: 13, motion: false } }}>
      <div className={'personal-app loaded system-ui is-win ' + (dark ? 'personal-dark' : 'personal-light')}>
        <UiTheme themeConfig={store.getUiThemeConfig()} />
        <ShortcutControl config={config} />
        <InputContextMenu />
        <TerminalInteractive />
        <PersonalLayout store={store} />
        <PersonalDialogs store={store} />
        <FileEditors store={store} />
        <FileInfoModal />
        <FileCompareModal />
        <ConfirmModalStore transferToConfirm={store.transferToConfirm} />
        <TransportsActionStore fileTransferChanged={JSON.stringify(transfers)} fileTransfers={transfers} config={config} />
        <Remote2RemoteHandlers />
        <TransferQueue />
        <TerminalCmdSuggestions suggestions={store.terminalCommandSuggestions} />
        <NotificationContainer />
      </div>
    </ConfigProvider>
  )
})
