/**
 * terminal/sftp wrapper
 */
import { createRef, Suspense } from 'react'
import { Component } from 'manate/react/class-components'
import ConsoleGroup from '../personal/console-group'
import Sftp from '../sftp/sftp-entry'
import {
  FullscreenOutlined
} from '@ant-design/icons'
import {
  Tooltip,
  Splitter
} from 'antd'
import { pick } from 'lodash-es'
import copy from 'json-deep-copy'
import classnames from 'classnames'
import {
  paneMap,
  terminalRdpType,
  terminalVncType,
  terminalWebType,
  terminalTelnetType,
  terminalSpiceType
} from '../../common/constants'
import { refs } from '../common/ref'
import sanitizeFilename from '../../common/sanitize-filename.js'
import SessionControl from '../personal/session-control'
import DatabasePanel from '../mysql/panel'
import { databaseLayout } from '../mysql/layout'
import { getWorkspaceState, registerWorkspaceState } from '../../common/workspace-state'
import './session.styl'

const e = window.translate
const SplitterPane = Splitter.Panel

export default class SessionWrapper extends Component {
  // 数据库布局属于当前标签页，不从其他标签页的操作继承状态。
  constructor (props) {
    super(props)
    this.domRef = createRef()
    this.consoleRef = createRef()
    const terminalPercent = Math.min(80, Math.max(20, props.config.personalTerminalPercent || 60))
    const saved = getWorkspaceState(props.tab.id, 'layout')
    this.state = {
      cwd: saved.cwd || '',
      sftpPathFollowSsh: saved.sftpPathFollowSsh ?? Boolean(props.config.sftpPathFollowSsh),
      key: Math.random(),
      splitSize: saved.splitSize || [terminalPercent, 100 - terminalPercent],
      databaseMode: saved.databaseMode || 'expanded',
      shellPercent: saved.shellPercent ?? 50,
      sessionOptions: null,
      broadcastInput: false,
      keepaliveEnabled: false,
      wrapDisabled: false,
      consoleDetached: false
    }
    if (props.tab.sshSftpSplitView === undefined) {
      props.tab.sshSftpSplitView = !!props.config.sshSftpSplitView
    }
  }

  getDom = () => {
    return this.domRef.current
  }

  isDisabled = () => {
    const { enableSsh, enableSftp } = this.props.tab
    return enableSsh === false || enableSftp === false
  }

  isSshDisabled = () => {
    return this.props.tab.enableSsh === false
  }

  isSftpDisabled = () => {
    return this.props.tab.enableSftp === false
  }

  handleSshSftpSplitView = () => {
    const nv = !this.props.tab.sshSftpSplitView
    this.editTab({
      sshSftpSplitView: nv
    })
    window.store.triggerResize()
  }

  // 个人版始终保留上下目录分区，窄窗口交由分隔线和内部滚动适配。
  canSplitView = () => !this.isDisabled()

  // 个人版固定为上方终端、下方文件。
  getSplitDirection = () => {
    const {
      sshSftpSplitView
    } = this.props.tab
    if (!sshSftpSplitView || !this.canSplitView()) {
      return 'tabed'
    }
    return 'topDown'
  }

  handleClick = () => {
    window.store.activeTabId = this.props.tab.id
  }

  onDrop = (e) => {
    e.preventDefault()
    const { target } = e
    if (!target) {
      return
    }
    let fromTab
    try {
      fromTab = JSON.parse(e.dataTransfer.getData('fromFile'))
    } catch (e) {
      return
    }
    const onDropElem = this.getDom()
    const { batch } = this.props.tab
    if (!onDropElem || !fromTab || fromTab.batch === batch) {
      return
    }
    const { store } = window
    const { tabs } = store
    const t = tabs.find(t => t.id === fromTab.id)
    if (!t) {
      return
    }
    // Handle currentTab change if needed
    const fromBatch = fromTab.batch
    if (window.store[`activeTabId${fromBatch}`] === fromTab.id && fromBatch !== batch) {
      // Find next tab in the same batch
      const nextTab = tabs.find((t, i) =>
        t.id !== fromTab.id && t.batch === fromBatch
      )
      window.store[`activeTabId${fromBatch}`] = nextTab ? nextTab.id : ''
    }
    t.batch = batch
    this.clearCls()
  }

  clearCls = () => {
    this.getDom()?.classList.remove('drag-over')
  }

  addCls = () => {
    this.getDom()?.classList.add('drag-over')
  }

  onDragEnter = () => {
    this.addCls()
  }

  onDragLeave = (e) => {
    this.clearCls()
  }

  onDragEnd = (e) => {
    this.clearCls()
    e && e.dataTransfer && e.dataTransfer.clearData()
  }

  setCwd = (cwd) => {
    this.setState({
      cwd
    })
  }

  toggleCheckSftpPathFollowSsh = () => {
    this.setState(prevState => ({
      sftpPathFollowSsh: !prevState.sftpPathFollowSsh
    }))
  }

  editTab = (up) => {
    const {
      tab,
      editTab
    } = this.props
    editTab(
      tab.id,
      up
    )
  }

  onChangePane = pane => {
    const update = {
      pane
    }
    if (pane === paneMap.fileManager) {
      this.setState({
        enableSftp: true
      })
    }
    this.editTab(update)
  }

  computePosition = (index) => {
    return {
      left: 0,
      top: 0
    }
  }

  getWidth = () => {
    return this.props.width
  }

  renderTerminals = () => {
    const {
      sessionOptions,
      sftpPathFollowSsh,
      broadcastInput
    } = this.state
    const {
      tab
    } = this.props
    const {
      pane, sshSftpSplitView
    } = tab
    const cls = pane === paneMap.terminal ||
      (sshSftpSplitView && this.canSplitView())
      ? 'terms-box'
      : 'terms-box hide'
    const {
      width,
      height
    } = this.calcTermWidthHeight()
    const themeConfig = copy(window.store.getThemeConfig())
    const logName = sanitizeFilename(`${tab.title ? tab.title + '_' : ''}${tab.host ? tab.host + '_' : ''}${tab.id}`)
    const pops = {
      ...this.props,
      sftpPathFollowSsh,
      themeConfig,
      broadcastInput,
      pane,
      ...pick(
        this,
        [
          'onChangePane',
          'setCwd'
        ]),
      ...this.computePosition(),
      width,
      height
    }
    return (
      <div
        className={cls}
        style={{
          width,
          height,
          background: themeConfig.background,
          '--terminal-background': themeConfig.background
        }}
      >
        <ConsoleGroup
          ref={this.consoleRef}
          onDetachedChange={value => this.setState({ consoleDetached: value })}
          logName={logName}
          sessionOptions={sessionOptions}
          {...pops}
        />
      </div>
    )
  }

  isNotTerminalType = () => {
    const { type } = this.props.tab
    return type === terminalRdpType ||
      type === terminalVncType ||
      type === terminalWebType ||
      type === terminalTelnetType ||
      type === terminalSpiceType
  }

  // 按当前分区比例计算文件区尺寸。
  calcSftpWidthHeight = () => {
    const {
      width,
      height
    } = this.props
    if (!this.canSplitView() || !this.props.tab.sshSftpSplitView) {
      return {
        width,
        height
      }
    }
    const direction = this.getSplitDirection()
    const [, size2] = this.state.splitSize
    const w = direction === 'leftRight' ? size2 * width / 100 : width
    const contentHeight = this.props.computeHeight(height)
    const h = direction === 'leftRight' ? contentHeight : size2 * contentHeight / 100
    return {
      width: w,
      height: h
    }
  }

  // 扣除工具栏后计算终端实际尺寸。
  calcTermWidthHeight = () => {
    const { shellWidth: width } = databaseLayout(this.getWidth(), this.state.databaseMode, this.state.shellPercent)
    const height = this.props.computeHeight(
      this.props.height
    )
    if (!this.canSplitView() || !this.props.tab.sshSftpSplitView) {
      return {
        width,
        height
      }
    }
    const direction = this.getSplitDirection()
    const [size1] = this.state.splitSize
    const w = direction === 'leftRight' ? size1 * width / 100 : width
    const h = direction === 'leftRight' ? height : size1 * height / 100
    return {
      width: w,
      height: h
    }
  }

  renderSftp = () => {
    const {
      sessionOptions,
      enableSftp,
      sftpPathFollowSsh,
      cwd
    } = this.state
    const { pane, id, sshSftpSplitView } = this.props.tab
    if (
      this.isNotTerminalType() ||
      this.isSftpDisabled()
    ) {
      return null
    }
    const height = this.props.computeHeight(
      this.props.height
    )
    const cls = pane === paneMap.fileManager ||
    (sshSftpSplitView && this.canSplitView())
      ? ''
      : 'hide'
    const exts = {
      ...this.props,
      sftpPathFollowSsh,
      sshSftpSplitView,
      cwd,
      pid: id,
      enableSftp,
      sessionOptions,
      height,
      pane,
      ...this.calcSftpWidthHeight()
    }
    return (
      <div className={cls}>
        <Sftp
          {...exts}
        />
      </div>
    )
  }

  handleFullscreen = () => {
    // Make this tab the active tab before fullscreening
    window.store.activeTabId = this.props.tab.id
    window.store.toggleSessFullscreen(true, this.props.tab.id)
  }

  toggleBroadcastInput = () => {
    this.setState({
      broadcastInput: !this.state.broadcastInput
    })
  }

  toggleKeepalive = () => {
    const term = refs.get('term-' + this.props.tab.id)
    if (!term) {
      return
    }
    const enabled = term.toggleKeepalive()
    this.setState({ keepaliveEnabled: enabled })
  }

  handleExitGracefully = () => {
    refs.get('term-' + this.props.tab.id)?.exitGracefully()
  }

  handleOpenSearch = () => {
    refs.get('term-' + this.props.tab.id)?.toggleSearch()
  }

  // touch-only: the toolbar menu icon opens the same context menu a right
  // click (or a long press) does, anchored just below the icon itself
  handleOpenContextMenu = (evt) => {
    const term = refs.get('term-' + this.props.tab.id)
    if (!term) {
      return
    }
    const rect = evt.currentTarget.getBoundingClientRect()
    term.openContextMenuAtPoint(rect.left, rect.bottom)
  }

  handleZoomFontSize = (v) => {
    const term = refs.get('term-' + this.props.tab.id)
    if (!term?.term) {
      return
    }
    term.zoom(v)
    term.term.focus()
  }

  toggleWrap = () => {
    const termRef = refs.get('term-' + this.props.tab.id)
    if (!termRef?.term) {
      return
    }
    const next = !this.state.wrapDisabled
    // DECAWM escape sequence: ?7l = disable wrap, ?7h = enable wrap
    termRef.term.write(next ? '\x1b[?7l' : '\x1b[?7h')
    this.setState({ wrapDisabled: next })
  }

  fullscreenIcon = () => {
    const title = e('fullscreen')
    return (
      <Tooltip title={title} placement='bottomLeft'>
        <FullscreenOutlined
          className='mg1r icon-info iblock pointer spliter fullscreen-control-icon'
          onClick={this.handleFullscreen}
        />
      </Tooltip>
    )
  }

  isSsh = () => {
    const { tab } = this.props
    return tab.authType
  }

  // 按实际面板总尺寸归一化，让窗口缩放时保持上下比例。
  onSplitResize = (sizes) => {
    const all = sizes.reduce((sum, value) => sum + value, 0)
    if (!all) return
    const size = sizes.map(value => value * 100 / all)
    this.setState({
      splitSize: size
    })
  }

  // 松开拖动条时保存上下布局，避免拖动过程频繁写入数据库。
  onSplitResizeEnd = (sizes) => {
    this.onSplitResize(sizes)
    const all = sizes.reduce((sum, value) => sum + value, 0)
    if (all) window.store.setConfig({ personalTerminalPercent: sizes[0] * 100 / all })
  }

  // 工具栏只切换当前标签页；恢复时保留数据库连接和工作内容。
  handleToggleDatabase = () => {
    this.setState(previous => ({ databaseMode: previous.databaseMode === 'expanded' ? 'hidden' : 'expanded' }))
  }

  // 关闭时读取当前尺寸和显隐，重开保持同一标签页的布局。
  componentDidMount () {
    this.unregisterWorkspace = registerWorkspaceState(this.props.tab.id, 'layout', () => ({ cwd: this.state.cwd, sftpPathFollowSsh: this.state.sftpPathFollowSsh, splitSize: this.state.splitSize, databaseMode: this.state.databaseMode, shellPercent: this.state.shellPercent }))
  }

  // 拖动和目录跟随变化合并为本地快照，避免频繁磁盘写入。
  componentDidUpdate (prevProps, prevState) {
    if (prevState.splitSize !== this.state.splitSize || ['cwd', 'sftpPathFollowSsh', 'databaseMode', 'shellPercent'].some(key => prevState[key] !== this.state[key])) window.store.scheduleWorkspaceSave()
  }

  // 标签关闭时释放状态读取器。
  componentWillUnmount () {
    this.unregisterWorkspace?.()
  }

  // 最小化仅保留右侧窄栏，不销毁数据库或终端。
  handleMinimizeDatabase = () => {
    this.setState({ databaseMode: 'minimized' })
  }

  // 隐藏后可从当前标签页工具栏重新打开。
  handleHideDatabase = () => {
    this.setState({ databaseMode: 'hidden' })
  }

  // 从最小化窄栏恢复当前标签页原来的尺寸。
  handleRestoreDatabase = () => {
    this.setState({ databaseMode: 'expanded' })
  }

  // 拖动横向分隔线时同步终端的实际列数。
  handleDatabaseResize = (sizes) => {
    if (this.state.databaseMode !== 'expanded') return
    const total = sizes.reduce((sum, size) => sum + size, 0)
    if (total) this.setState({ shellPercent: sizes[0] * 100 / total })
  }

  // 拖动比例只保存在当前组件，不写入全局配置。
  handleDatabaseResizeEnd = (sizes) => {
    this.handleDatabaseResize(sizes)
  }

  // 终端右侧是可收起的 MySQL 工作区，继续使用统一的分隔线组件。
  renderTerminalArea = () => {
    const { databaseMode, shellPercent } = this.state
    const expanded = databaseMode === 'expanded'
    const layout = databaseLayout(this.props.width, databaseMode, shellPercent)
    const { height } = this.calcTermWidthHeight()
    return (
      <Splitter className={'personal-database-splitter' + (expanded ? '' : ' database-closed')} style={{ width: this.props.width, height }} onResize={this.handleDatabaseResize} onResizeEnd={this.handleDatabaseResizeEnd}>
        <SplitterPane size={layout.shellWidth} min={expanded ? layout.shellMin : 0} max={expanded ? this.props.width - layout.databaseMin : this.props.width} resizable={expanded} style={{ overflow: 'hidden' }}>{this.renderTerminals()}</SplitterPane>
        <SplitterPane size={layout.databaseWidth} min={expanded ? layout.databaseMin : 0} resizable={expanded} style={{ overflow: 'hidden' }}><DatabasePanel tab={this.props.tab} height={height} mode={databaseMode} active={this.props.tab.id === this.props.activeTabId} onMinimize={this.handleMinimizeDatabase} onHide={this.handleHideDatabase} onRestore={this.handleRestoreDatabase} /></SplitterPane>
      </Splitter>
    )
  }

  renderViews = () => {
    if (this.isNotTerminalType()) {
      return this.renderTerminals()
    }
    const notSplitVew = !this.canSplitView() || !this.props.tab.sshSftpSplitView
    const { pane } = this.props.tab
    const show1 = notSplitVew && pane === paneMap.terminal
    const show2 = notSplitVew && pane === paneMap.fileManager
    const direction = this.getSplitDirection()
    const layout = direction === 'leftRight' ? 'horizontal' : 'vertical'
    const [size1, size2] = this.state.splitSize
    const splitterProps = {
      orientation: layout,
      onResize: this.onSplitResize,
      onResizeEnd: this.onSplitResizeEnd,
      className: notSplitVew ? 'not-split-view' : 'personal-session-splitter',
      style: {
        width: this.props.width + 'px',
        height: this.props.computeHeight(this.props.height) + 'px'
      }
    }
    const paneProps = {
      min: '20%',
      max: '80%',
      style: {
        overflow: 'hidden'
      }
    }
    const s1 = show1
      ? '100%'
      : show2
        ? '0%'
        : size1 + '%'
    const s2 = show2
      ? '100%'
      : show1
        ? '0%'
        : size2 + '%'
    const paneProps1 = {
      ...paneProps,
      size: s1
    }
    const paneProps2 = {
      ...paneProps,
      size: s2
    }
    return (
      <Splitter {...splitterProps}>
        <SplitterPane {...paneProps1}>
          {this.renderTerminalArea()}
        </SplitterPane>
        <SplitterPane {...paneProps2}>
          {this.renderSftp()}
        </SplitterPane>
      </Splitter>
    )
  }

  render () {
    const { pane } = this.props.tab
    const cls = classnames(
      'term-sftp-box',
      pane,
      {
        'is-transporting': this.props.tab.isTransporting
      },
      {
        'disable-ssh': this.props.tab.enableSsh === false
      }
    )
    const divProps = {
      className: cls,
      onDragEnter: this.onDragEnter,
      onDragLeave: this.onDragLeave,
      onDrop: this.onDrop,
      onDragEnd: this.onDragEnd,
      onClick: this.handleClick
    }
    return (
      <div
        ref={this.domRef}
        {...divProps}
      >
        <SessionControl
          consoleDetached={this.state.consoleDetached}
          onToggleConsoleWindow={() => this.consoleRef.current?.togglePopout()}
          tab={this.props.tab}
          databaseOpen={this.state.databaseMode === 'expanded'}
          onToggleDatabase={this.handleToggleDatabase}
          isMobile={window.store.isMobile}
          isTouchDevice={window.store.isTouchDevice}
          isDisabled={this.isDisabled()}
          isSshDisabled={this.isSshDisabled()}
          isNotTerminalType={this.isNotTerminalType()}
          canSplitView={this.canSplitView()}
          sftpPathFollowSsh={this.state.sftpPathFollowSsh}
          keepaliveEnabled={this.state.keepaliveEnabled}
          broadcastInput={this.state.broadcastInput}
          wrapDisabled={this.state.wrapDisabled}
          pasteWhenContextMenu={!!this.props.config.pasteWhenContextMenu}
          onChangePane={(pane) => this.onChangePane(pane)}
          toggleCheckSftpPathFollowSsh={this.toggleCheckSftpPathFollowSsh}
          onSshSftpSplitView={this.handleSshSftpSplitView}
          toggleKeepalive={this.toggleKeepalive}
          toggleBroadcastInput={this.toggleBroadcastInput}
          toggleWrap={this.toggleWrap}
          onFullscreen={this.handleFullscreen}
          onZoomFontSize={this.handleZoomFontSize}
          onOpenSearch={this.handleOpenSearch}
          onOpenContextMenu={this.handleOpenContextMenu}
          onExitGracefully={this.handleExitGracefully}
        />
        <Suspense fallback={null}>
          {this.renderViews()}
        </Suspense>
      </div>
    )
  }
}
