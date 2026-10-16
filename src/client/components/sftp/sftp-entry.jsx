import { Component } from 'react'
import { refs } from '../common/ref'
import generate from '../../common/uid'
import runIdle from '../../common/run-idle'
import { Spin, Button, Space } from 'antd'
import { notification } from '../common/notification'
import Modal from '../common/modal'
import clone from '../../common/to-simple-obj'
import { last, isNumber, some, isArray, pick, uniq, debounce } from 'lodash-es'
import FileSection from './file-item'
import resolve from '../../common/resolve'
import classnames from 'classnames'
import sorterIndex from '../../common/index-sorter'
import { handleErr } from '../../common/fetch'
import { getLocalFileInfo, getLocalDirectoryInfo, getRemoteFileInfo, getFolderFromFilePath } from './file-read'
import {
  typeMap, maxSftpHistory, paneMap,
  fileTypeMap,
  terminalSerialType,
  terminalFtpType
} from '../../common/constants'
import { hasFileInClipboardText } from '../../common/clipboard'
import Client from '../../common/sftp'
import ListTable from './list-table-ui'
import deepCopy from 'json-deep-copy'
import isValidPath from '../../common/is-valid-path'
import normalizeRemotePath from '../../common/normalize-remote-path'
import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import * as owner from './owner-list'
import AddressBar from './address-bar'
import getProxy from '../../common/get-proxy'
import { createTerm } from '../terminal/terminal-apis'
import FileBrowser from '../personal/file-browser'
import { getWorkspaceState, registerWorkspaceState } from '../../common/workspace-state'
import './sftp.styl'
import { sortFileList } from '../../common/file-list-navigation'
import DirectoryCache from '../../common/directory-cache'

const e = window.translate

export default class Sftp extends Component {
  constructor (props) {
    super(props)
    this.state = {
      id: props.id || generate(),
      selectedFiles: new Set(),
      selectedType: '',
      lastClickedFile: null,
      onEditFile: false,
      ...this.defaultState(),
      ...getWorkspaceState(props.tab.id, 'files'),
      loadingSftp: false,
      inited: false,
      ready: false
    }
    // 旧工作区的默认时间排序迁移为名称排序，之后仍保存用户手动选择的列。
    const saved = getWorkspaceState(props.tab.id, 'files')
    if (saved.sortVersion !== 1) {
      for (const type of ['local', 'remote']) {
        this.state[`sortProp.${type}`] = 'name'
        this.state[`sortDirection.${type}`] = 'asc'
      }
    }
    this.retryCount = 0
  }

  componentDidMount () {
    this.id = 'sftp-' + this.props.tab.id
    refs.add(this.id, this)
    // 只保存路径、排序和筛选，不持久化文件缓存或 SFTP 对象。
    this.unregisterWorkspace = registerWorkspaceState(this.props.tab.id, 'files', () => {
      const state = { sortVersion: 1 }
      for (const type of ['local', 'remote']) {
        for (const key of [type + 'Path', type + 'PathTemp', type + 'ShowHiddenFile', type + 'Keyword', 'sortProp.' + type, 'sortDirection.' + type]) state[key] = this.state[key]
      }
      return state
    })
    if (this.props.isFtp) {
      this.initFtpData()
    }
    this.timer = setTimeout(() => {
      this.setState({
        ready: true
      })
    }, 0)
  }

  componentDidUpdate (prevProps, prevState) {
    if (['localPath', 'remotePath', 'localShowHiddenFile', 'remoteShowHiddenFile', 'localKeyword', 'remoteKeyword', 'sortProp.local', 'sortProp.remote', 'sortDirection.local', 'sortDirection.remote'].some(key => prevState[key] !== this.state[key])) window.store.scheduleWorkspaceSave()
    if (
      this.props.config.autoRefreshWhenSwitchToSftp &&
      prevProps.pane !== this.props.pane &&
      this.props.pane === paneMap.fileManager &&
      this.state.inited
    ) {
      this.onGoto(typeMap.local)
      this.onGoto(typeMap.remote)
    }
    if (
      prevState.remotePath !== this.state.remotePath &&
      this.state.selectedType === typeMap.remote
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    } else if (
      prevState.localPath !== this.state.localPath &&
      this.state.selectedType === typeMap.local
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    }
    if (
      this.props.sftpPathFollowSsh &&
      prevProps.cwd !== this.props.cwd
    ) {
      this.updateCwd(this.props.cwd)
    }
  }

  componentWillUnmount () {
    this.directoryDisposed = true
    for (const type of ['local', 'remote']) {
      this.cancelDirectoryPrefetch(type)
      this.directoryCaches.get(type)?.dispose()
    }
    this.unregisterWorkspace?.()
    refs.remove(this.id)
    this.sftp && this.sftp.destroy()
    this.sftp = null
    clearTimeout(this.timer)
    this.timer = null
    clearTimeout(this.timer4)
    this.timer4 = null
    clearTimeout(this.retryHandler)
    this.retryHandler = null
    this._visibleFileLists.clear()
    this.remoteListDebounce.cancel()
    this.localListDebounce.cancel()
  }

  initFtpData = async () => {
    this.type = 'ftp'
    const { tab } = this.props
    const { id } = tab
    const opts = clone({
      tabId: id,
      uid: tab.id,
      srcTabId: tab.id,
      termType: 'ftp',
      ...tab
    })
    const r = await createTerm(opts)
      .catch(err => {
        const text = err.message
        handleErr({ message: text })
      })
    if (!r) {
      return
    }
    const {
      port
    } = r
    this.initData(undefined, port)
  }

  directions = [
    'desc',
    'asc'
  ]

  defaultDirection = (i = 0) => {
    return this.directions[i]
  }

  getFileItemById = (id, type) => {
    if (type) {
      return this.state[`${type}FileTree`].get(id)
    }
    return this.getFileItemById(id, typeMap.local) ||
      this.getFileItemById(id, typeMap.remote)
  }

  defaultState = () => {
    const def = this.props.config.showHiddenFilesOnSftpStart
    return Object.keys(typeMap).reduce((prev, k, i) => {
      Object.assign(prev, {
        [`sortProp.${k}`]: window.store.sftpSortSetting[k].prop,
        [`sortDirection.${k}`]: window.store.sftpSortSetting[k].direction,
        [k]: [],
        [`${k}FileTree`]: new Map(),
        [`${k}Loading`]: false,
        [`${k}InputFocus`]: false,
        [`${k}ShowHiddenFile`]: def,
        [`${k}Path`]: '',
        [`${k}PathTemp`]: '',
        [`${k}PathHistory`]: [],
        [`${k}GidTree`]: new Map(),
        [`${k}UidTree`]: new Map(),
        [`${k}Keyword`]: ''
      })
      return prev
    }, {})
  }

  // 只保留本地和远程当前列表的结果，选择文件时不重复排序。
  _visibleFileLists = new Map()

  // 所有类型统一按当前列排序，不再先分文件夹和文件。
  sort = (list, type, direction, property) => sortFileList(list || [], property, direction)
  isActive () {
    const { currentBatchTabId, pane, sshSftpSplitView } = this.props
    const { tab } = this.props
    const isFtp = tab.type === terminalFtpType

    return (currentBatchTabId === tab.id && (pane === paneMap.fileManager || sshSftpSplitView)) || isFtp
  }

  updateKeyword = (keyword, type) => {
    this.setState({
      [`${type}Keyword`]: keyword
    })
  }

  getCwdLocal = () => {
    if (
      !this.shouldRenderRemote() &&
      this.props.sftpPathFollowSsh &&
      this.props.cwd
    ) {
      return this.props.cwd
    }
  }

  gotoHome = async (type) => {
    let path

    if (type === typeMap.remote) {
      path = this.props.tab.startDirectoryRemote
      if (!path && this.sftp) {
        path = await this.getPwd(this.props.tab.username)
      }
      if (!path) {
        // No sftp connection yet (still connecting, or the previous attempt
        // failed). There is no remote home to resolve, and navigating to an
        // unknown path would blank the panel, so (re)start the connection and
        // let its own listing decide the path.
        if (
          !this.sftp &&
          !this.state.loadingSftp &&
          !this.state.remoteLoading
        ) {
          this.initData(this.terminalId, this.port)
        }
        return
      }
      path = normalizeRemotePath(path)
    } else {
      path = this.getLocalHome()
    }

    if (typeof path !== 'string' || !path) {
      return
    }

    this.navigateDirectory(type, path)
  }

  updateCwd = (cwd = this.props.cwd) => {
    if (!this.state.inited) {
      return
    }
    const type = this.shouldRenderRemote()
      ? typeMap.remote
      : typeMap.local
    // this.setState({
    //   [`${type}PathTemp`]: cwd
    // }, () => {
    //   this.onGoto(
    //     type
    //   )
    // })
    if (cwd && cwd !== this.state[type + 'Path']) this.navigateDirectory(type, cwd)
  }

  getPwd = async (username) => {
    if (this.props.sftpPathFollowSsh && this.props.cwd) {
      return this.props.cwd
    }
    const home = await this.sftp.getHomeDir()
    if (home) {
      return home.trim()
    } else {
      return username === 'root'
        ? '/root'
        : `/home/${this.props.tab.username}`
    }
  }

  getIndex = (file) => {
    const { type } = file
    return this.getFileList(type).findIndex(f => f.id === file.id)
  }

  selectAll = (type, e) => {
    e && e.preventDefault && e.preventDefault()
    this.setState({
      selectedFiles: new Set(this.getFileList(type).map(f => f.id))
    })
  }

  selectNext = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const lastOne = last(fileIndices)
    let next = 0
    if (isNumber(lastOne)) {
      next = (lastOne + 1) % fileList.length
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  selectPrev = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const firstOne = fileIndices[0]
    let next = 0
    const len = fileList.length
    if (isNumber(firstOne)) {
      next = (firstOne - 1 + len) % len
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  localDel = async (file) => {
    const { name, isDirectory, path } = file
    const func = !isDirectory
      ? window.fs.unlink
      : window.fs.rmrf
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  remoteDel = async (file) => {
    const { name, isDirectory, path } = file
    const { sftp } = this
    const func = isDirectory
      ? sftp.rmdir
      : sftp.rm
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  confirmDelete = (files) => {
    return new Promise((resolve) => {
      Modal.confirm({
        title: this.renderDelConfirmTitle(files),
        okText: e('ok'),
        cancelText: e('cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }

  getSelectedFiles = (selectedFiles = this.state.selectedFiles) => {
    // Convert Set of IDs to array of file objects
    return Array.isArray(selectedFiles)
      ? selectedFiles
      : Array.from(selectedFiles)
        .map(id => this.getFileItemById(id))
        .filter(Boolean) // Filter out any undefined items
  }

  delFiles = async (_type, files = this.getSelectedFiles()) => {
    this.onDelete = true
    const confirm = await this.confirmDelete(files)
    this.onDelete = false
    if (!confirm) {
      return
    }
    const type = files[0]?.type || _type
    const func = this[type + 'Del']
    await Promise.all(files.map(f => func(f)))
    this[type + 'List']()
  }

  renderDelConfirmTitle (files = this.getSelectedFiles(), pureText) {
    const hasDirectory = some(files, f => f.isDirectory)
    const names = hasDirectory ? e('filesAndFolders') : e('files')
    if (pureText) {
      const t1 = hasDirectory
        ? e('delTip1')
        : ''
      return `${e('delTip')} ${names} ${t1} (${files.length})`
    }
    return (
      <div className='wordbreak'>
        {e('delTip')}
        {names}
        {
          hasDirectory
            ? e('delTip1')
            : ''
        }
        (<b className='mg1x'>{files.length}</b>)
      </div>
    )
  }

  enter = (type, e) => {
    const { selectedFiles, onEditFile } = this.state
    if (onEditFile || selectedFiles.size !== 1) {
      return
    }
    const fileId = Array.from(selectedFiles)[0]
    const file = this.getFileItemById(fileId)
    if (!file) {
      return
    }
    const { isDirectory } = file
    if (isDirectory) {
      this[type + 'Dom'].enterDirectory(e, file)
    } else {
      this.setState({
        filesToConfirm: [file]
      })
    }
  }

  onInputFocus = (type) => {
    this.setState({
      [type + 'InputFocus']: true
    })
    this.inputFocus = true
  }

  onInputBlur = (type) => {
    this.inputFocus = false
    this.timer4 = setTimeout(() => {
      this.setState({
        [type + 'InputFocus']: false
      })
    }, 200)
  }

  doCopy = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCopy(selectedFiles)
  }

  doCut = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCut(selectedFiles)
  }

  doPaste = (type) => {
    if (!hasFileInClipboardText()) {
      return
    }
    this[type + 'Dom'].onPaste()
  }

  initData = (terminalId, port) => {
    this.terminalId = terminalId
    this.port = port
    if (this.shouldRenderRemote()) {
      this.initRemoteAll()
    } else this.initLocalAll()
  }

  shouldRenderRemote = () => {
    const { props } = this
    return props.tab?.host && props.tab?.type !== terminalSerialType
  }

  initLocalAll = () => {
    this.localListOwner()
    this.localList()
  }

  initRemoteAll = async () => {
    await Promise.all([
      this.remoteList(),
      this.remoteListOwner().catch(e => console.debug('remoteListOwner error:', e))
    ])
  }

  modifier = (...args) => {
    // Check if first argument is an object and contains path changes
    if (args[0] && typeof args[0] === 'object') {
      const updates = args[0]

      // Clear respective keyword if path changes
      if (updates.localPath !== undefined) {
        updates.localKeyword = ''
      }
      if (updates.remotePath !== undefined) {
        updates.remoteKeyword = ''
      }

      // For selectedFiles updates, call setState immediately for better responsiveness
      if (updates.selectedFiles !== undefined) {
        return this.setState(...args)
      }
    }

    // For other updates, use runIdle to avoid blocking the UI
    runIdle(() => this.setState(...args))
  }

  addTransferList = list => {
    window.store.addTransferList(list)
  }

  onError = e => {
    window.store.onError(e)
    this.setState({
      remoteLoading: false
    })
  }

  getFileList = type => {
    const showHide = this.state[`${type}ShowHiddenFile`]
    const keyword = this.state[`${type}Keyword`]
    let list = this.state[type]
    list = isArray(list) ? list : []
    const direction = this.state[`sortDirection.${type}`]
    const property = this.state[`sortProp.${type}`]
    const cached = this._visibleFileLists.get(type)
    if (cached && cached.source === list && cached.hidden === showHide && cached.keyword === keyword && cached.direction === direction && cached.property === property) return cached.result
    const source = list

    // Combine filtering for showHide and keyword in one loop
    if (!showHide || keyword) {
      const lowerKeyword = keyword.toLowerCase()
      list = list.filter(f => {
        if (!showHide && f.name.startsWith('.')) {
          return false
        }
        if (keyword && !f.name.toLowerCase().includes(lowerKeyword)) {
          return false
        }
        return true
      })
    }

    const result = this.sort(list, type, direction, property)
    this._visibleFileLists.set(type, { source, hidden: showHide, keyword, direction, property, result })
    return result
  }

  toggleShowHiddenFile = type => {
    const prop = `${type}ShowHiddenFile`
    const b = this.state[prop]
    this.setState({
      [prop]: !b
    })
  }

  buildTree = (arr, type, folder = this.state[type + 'Path']) => {
    const parent = this.renderParentItem(type, folder)
    const treeMap = new Map(arr.map(d => [d.id, d]))

    // Only add parent if it exists
    if (parent) {
      treeMap.set(parent.id, parent)
    }

    return treeMap
  }

  remoteListOwner = async () => {
    const [remoteUidTree, remoteGidTree] = await Promise.all([
      owner.remoteListUsers(this.props.pid),
      owner.remoteListGroups(this.props.pid)
    ])
    this.setState({
      remoteGidTree,
      remoteUidTree
    })
  }

  localListOwner = async () => {
    const [localUidTree, localGidTree] = await Promise.all([
      owner.localListUsers(),
      owner.localListGroups()
    ])
    this.setState({
      localGidTree,
      localUidTree
    })
  }

  sftpList = (sftp, remotePath) => {
    return sftp.list(remotePath)
      .then(arr => {
        return arr.map(item => {
          const { type } = item
          return {
            ...pick(
              item,
              ['name', 'size', 'accessTime', 'modifyTime', 'mode', 'owner', 'group']
            ),
            isDirectory: type === fileTypeMap.directory,
            type: typeMap.remote,
            path: remotePath,
            isSymbol: type === fileTypeMap.link,
            id: generate()
          }
        })
      })
  }

  directoryCaches = new Map()
  directoryRequests = { local: 0, remote: 0 }
  directoryPrefetch = {}
  directoryPrefetchRunning = {}
  directoryDisposed = false
  sftpGeneration = 0

  // 文件列表、目录树和预读共用当前标签的同一份缓存与请求。
  getDirectoryCache = type => {
    if (!this.directoryCaches.has(type)) this.directoryCaches.set(type, new DirectoryCache(folder => type === typeMap.remote ? this.readRemoteDirectory(folder) : getLocalDirectoryInfo(folder)))
    return this.directoryCaches.get(type)
  }

  // 并发读取目录时只建立一个 SFTP 通道，重连和卸载会丢弃旧连接。
  ensureSftp = () => {
    if (this.sftp) return Promise.resolve(this.sftp)
    if (this.sftpConnecting) return this.sftpConnecting
    const generation = this.sftpGeneration
    const { tab, sessionOptions, config } = this.props
    this.setState({ loadingSftp: true })
    const request = (async () => {
      const client = await Client(this.terminalId, this.type, this.port)
      try {
        const connected = await client.connect(deepCopy({ ...tab, readyTimeout: config.sshReadyTimeout, terminalId: this.terminalId, keepaliveInterval: config.keepaliveInterval, proxy: getProxy(tab, config), ...sessionOptions }))
        if (!connected || this.directoryDisposed || generation !== this.sftpGeneration) throw new Error('文件连接已关闭')
        this.sftp = client
        this.props.editTab(tab.id, { sftpCreated: true })
        return client
      } catch (error) { client.destroy(); throw error }
    })().finally(() => {
      if (this.sftpConnecting !== request) return
      this.sftpConnecting = null
      if (!this.directoryDisposed) this.setState({ loadingSftp: false })
    })
    this.sftpConnecting = request
    return request
  }

  // 一层目录只列举一次，符号链接属性有限并发补齐且不改写其他目录界面。
  readRemoteDirectory = async folder => {
    const sftp = await this.ensureSftp()
    const list = await this.sftpList(sftp, folder)
    const links = list.filter(file => file.isSymbol)
    let next = 0
    // 只对链接追加 stat，普通目录项沿用 SFTP 已返回的属性。
    async function followLinks () {
      while (next < links.length) {
        const file = links[next++]
        const info = await getRemoteFileInfo(sftp, resolve(folder, file.name)).catch(() => null)
        file.isSymbolicLink = true
        file.isDirectory = info?.isDirectory || false
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, links.length) }, followLinks))
    return list
  }

  // 导航同步显示近期快照，过期内容后台更新；迟到响应不能覆盖新路径。
  navigateDirectory = async (type, folder, { refresh = false, oldPath = this.state[type + 'Path'], preserveInput = false } = {}) => {
    if (!folder || this.directoryDisposed) return
    if (type === typeMap.remote) folder = normalizeRemotePath(folder)
    else if (/^[a-z]:[\\/]?$/i.test(folder)) folder = folder.slice(0, 2) + '\\'
    this.cancelDirectoryPrefetch(type)
    const request = ++this.directoryRequests[type]
    const cache = this.getDirectoryCache(type)
    const previous = this.state[type]
    if (refresh) cache.invalidate(folder)
    const snapshot = cache.peek(folder)?.list
    const visible = snapshot || (folder === oldPath ? previous : [])
    this.setState({
      [type + 'Path']: folder,
      [type + 'PathTemp']: preserveInput && this.state[type + 'PathTemp'] && this.state[type + 'PathTemp'] !== oldPath ? this.state[type + 'PathTemp'] : folder,
      [type]: visible,
      [type + 'FileTree']: this.buildTree(visible, type, folder),
      [type + 'Loading']: !snapshot,
      [type + 'Keyword']: folder === oldPath ? this.state[type + 'Keyword'] : '',
      selectedFiles: new Set(),
      lastClickedFile: null,
      onEditFile: false
    })
    try {
      const list = await cache.read(folder)
      if (this.directoryDisposed || request !== this.directoryRequests[type]) return list
      const history = oldPath && oldPath !== folder ? uniq([oldPath, ...this.state[type + 'PathHistory']]).slice(0, maxSftpHistory) : this.state[type + 'PathHistory']
      this.setState({ [type]: list, [type + 'FileTree']: this.buildTree(list, type, folder), [type + 'Loading']: false, [type + 'PathHistory']: history, inited: true }, () => this.warmAdjacentDirectories(type, folder, list))
      return list
    } catch (error) {
      if (this.directoryDisposed || request !== this.directoryRequests[type]) return
      cache.invalidate(folder)
      const rollback = oldPath || folder
      const list = cache.peek(rollback)?.list || previous
      this.setState({ [type + 'Path']: rollback, [type + 'PathTemp']: rollback, [type]: list, [type + 'FileTree']: this.buildTree(list, type, rollback), [type + 'Loading']: false })
      this.onError(error)
    }
  }

  // 后台预读只读父目录和最多两个直接子目录，大目录跳过自动预读。
  warmAdjacentDirectories = (type, folder, list) => {
    if (list.length > 2000) return
    let parent = resolve(folder, '..')
    if (type === typeMap.local && /^[a-z]:$/i.test(parent)) parent += '\\'
    const paths = parent !== folder && !(type === typeMap.local && parent === '/') ? [parent] : []
    let children = 0
    for (const file of this.getFileList(type)) {
      if (file.isDirectory && !file.isSymbolicLink && file.name !== '.' && file.name !== '..') { paths.push(resolve(folder, file.name)); children++ }
      if (children >= 2) break
    }
    this.scheduleDirectoryPrefetch(type, paths)
  }

  // 用户停留的目录优先预读，仍只读一层并复用已经进行中的请求。
  prefetchDirectory = (type, folder) => this.scheduleDirectoryPrefetch(type, [folder], 200)

  // 每次导航取消尚未开始的预读，正在读取的一层结束后不再继续旧队列。
  cancelDirectoryPrefetch = type => {
    const pending = this.directoryPrefetch[type]
    if (pending) { clearTimeout(pending.timer); pending.cancelled = true }
    delete this.directoryPrefetch[type]
  }

  // 空闲后串行预读少量候选；切换标签、导航或关闭面板即停止后续请求。
  scheduleDirectoryPrefetch = (type, paths, delay = 350) => {
    this.cancelDirectoryPrefetch(type)
    if (this.directoryDisposed || !this.isActive()) return
    const cache = this.getDirectoryCache(type)
    const pending = { cancelled: false }
    pending.timer = setTimeout(async () => {
      await this.directoryPrefetchRunning[type]
      if (pending.cancelled || this.directoryDisposed || !this.isActive()) return
      const work = (async () => {
        for (const folder of [...new Set(paths)].slice(0, 3)) {
          if (pending.cancelled || this.directoryDisposed || !this.isActive()) break
          try { await cache.read(folder) } catch { /* 预读无权限的目录不打断用户当前操作。 */ }
        }
      })()
      this.directoryPrefetchRunning[type] = work
      await work
      if (this.directoryPrefetchRunning[type] === work) delete this.directoryPrefetchRunning[type]
      if (this.directoryPrefetch[type] === pending) delete this.directoryPrefetch[type]
    }, delay)
    this.directoryPrefetch[type] = pending
  }

  // 默认调用用于刷新；目录树只读取缓存，不改变路径、选择或加载状态。
  remoteList = async (returnList = false, folder, oldPath) => {
    const navigation = this.directoryRequests.remote
    try {
      await this.ensureSftp()
      folder = normalizeRemotePath(folder || this.state.remotePath || this.props.tab.startDirectory || await this.getPwd(this.props.tab.username))
      if (returnList) return this.getDirectoryCache(typeMap.remote).read(folder)
      // 初始主目录迟到时不能盖掉已经进入的目录，刷新也保留正在编辑的地址。
      if (this.directoryDisposed || navigation !== this.directoryRequests.remote) return
      return this.navigateDirectory(typeMap.remote, folder, { refresh: !oldPath, oldPath: oldPath || this.state.remotePath, preserveInput: true })
    } catch (error) { if (returnList) throw error; if (!this.directoryDisposed) this.onError(error) }
  }

  // 保持本机默认目录规则；普通目录通过一次批量属性请求完成读取。
  getLocalHome = () => this.props.tab.startDirectoryLocal || this.props.config.startDirectoryLocal || window.pre.homeOrTmp

  // 本地刷新与远程使用同样的缓存失效和请求顺序规则。
  localList = (returnList = false, folder, oldPath) => {
    if (!window.fs) return
    folder = folder || this.state.localPath || this.getCwdLocal() || this.getLocalHome()
    if (returnList) return this.getDirectoryCache(typeMap.local).read(folder)
    return this.navigateDirectory(typeMap.local, folder, { refresh: !oldPath, oldPath: oldPath || this.state.localPath, preserveInput: true })
  }

  remoteListDebounce = debounce(this.remoteList, 200)

  localListDebounce = debounce(this.localList, 200)

  timers = {}

  onChange = (e, prop) => {
    this.setState({
      [prop]: e.target.value
    })
  }

  onClickHistory = (type, path) => {
    this.navigateDirectory(type, path)
  }

  handleReloadRemoteSftp = async () => {
    this.sftpGeneration++
    this.sftpConnecting = null
    this.directoryRequests.remote++
    this.cancelDirectoryPrefetch(typeMap.remote)
    this.directoryCaches.get(typeMap.remote)?.clear()
    if (this.sftp) {
      this.sftp.destroy()
      this.sftp = null
    }
    this.setState({
      remoteLoading: true,
      remote: [],
      remoteFileTree: new Map()
    }, () => {
      this.initRemoteAll()
    })
  }

  handleUploadFromBrowser = () => {
    if (window.et.handleUploadFromBrowser) {
      return window.et.handleUploadFromBrowser(
        this.state.localPath,
        this.localList
      )
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files
      if (!files || !files.length) return
      const { localPath } = this.state
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('path', localPath)
        await window.api.fetch('/api/upload', {
          method: 'POST',
          body: formData
        }).catch(handleErr)
      }
      this.localList()
    }
    input.click()
  }

  parsePath = async (type, pth) => {
    const reg = /^%([^%]+)%/
    if (!reg.test(pth)) {
      return pth
    }
    const m = pth.match(reg)
    if (!m || !m[1]) {
      return pth
    }
    const envName = m[1]
    const envPath = await window.pre.runGlobalAsync('getEnv', envName)
    if (envPath) {
      return pth.replace(reg, envPath)
    }
    return pth
  }

  onGoto = async (type, e) => {
    e && e.preventDefault()
    const n = `${type}Path`
    const nt = n + 'Temp'
    const oldPath = this.state[type + 'Path']
    let np = await this.parsePath(type, e?.target?.value ?? this.state[nt])
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    } else if (np.length > 1 && np.endsWith('/')) {
      // Strip trailing slash except for root path and Windows drive roots
      if (!/^[a-zA-Z]:\/$/.test(np)) {
        np = np.replace(/\/+$/, '')
      }
    }
    if (!isValidPath(np)) {
      return notification.warning({
        message: 'path not valid'
      })
    }
    this.navigateDirectory(type, np, { refresh: np === oldPath })
  }

  goParent = (type) => {
    const p = this.state[type + 'Path']
    if (typeof p !== 'string' || !p) {
      return
    }
    let np = resolve(p, '..')
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    }
    if (np !== p) this.navigateDirectory(type, np)
  }

  getFileProps = (file, type) => {
    return {
      ...this.props,
      file,
      type,
      ...pick(this, [
        'sftp',
        'modifier',
        'localList',
        'remoteList',
        'localDel',
        'remoteDel',
        'delFiles',
        'getIndex',
        'selectAll',
        'getFileList',
        'onGoto',
        'addTransferList',
        'renderDelConfirmTitle',
        'getSelectedFiles',
        'getFileItemById',
        'navigateDirectory'
      ]),
      ...pick(this.state, [
        'id',
        'localPath',
        'remotePath',
        'localFileTree',
        'remoteFileTree',
        'localOrder',
        'remoteOrder',
        'sortData',
        typeMap.local,
        typeMap.remote,
        'lastClickedFile',
        'lastMataKey',
        'targetTransferType',
        'selectedFiles',
        'localGidTree',
        'remoteUidTree',
        'localUidTree',
        'remoteGidTree'
      ])
    }
  }

  renderEmptyFile = (type, extra = {}) => {
    const uniqueId = this.getPathUid(type, 'empty')
    const item = {
      type,
      name: '',
      isDirectory: true,
      id: uniqueId,
      isEmpty: true
    }
    const allProps = {
      ...this.getFileProps(item, type),
      ...extra,
      cls: 'virtual-file-unit',
      key: 'empty' + type,
      isEmpty: true,
      draggable: false,
      ref: ref => {
        this[type + 'Dom'] = ref
      }
    }
    return (
      <div
        className={`virtual-file virtual-file-${type}`}
      >
        <FileSection
          {...allProps}
          key={uniqueId}
        />
      </div>
    )
  }

  getPathUid = (type, type1, currentPath = this.state[type + 'Path']) => {
    const parentPath = resolve(currentPath, '..')
    const { id } = this.props.tab
    return `${type1}-${parentPath}-${id}-${type}`
  }

  renderParentItem = (type, currentPath = this.state[type + 'Path']) => {
    // The path can be momentarily unknown (e.g. the remote home while the sftp
    // client is still connecting). Show no parent item rather than throwing.
    if (typeof currentPath !== 'string') {
      return null
    }
    const parentPath = resolve(currentPath, '..')
    // Don't render parent item if we're at the root
    if (parentPath === currentPath) {
      return null
    }

    const uniqueId = this.getPathUid(type, 'parent', currentPath)

    return {
      type,
      isDirectory: true,
      ...getFolderFromFilePath(parentPath, type === typeMap.remote),
      id: uniqueId,
      size: 0,
      modifyTime: 0,
      accessTime: 0,
      mode: 0,
      owner: '',
      group: '',
      isParent: true
    }
  }

  renderHistory = (type) => {
    const currentPath = this.state[type + 'Path']
    const options = this.state[type + 'PathHistory']
      .filter(o => o !== currentPath)
    const focused = this.state[type + 'InputFocus']
    if (!options.length) {
      return null
    }
    const cls = classnames(
      'sftp-history',
      `sftp-history-${type}`,
      { focused }
    )
    return (
      <div
        className={cls}
      >
        {
          options.map(o => {
            return (
              <div
                key={o}
                className='sftp-history-item'
                onClick={() => this.onClickHistory(type, o)}
              >
                {o}
              </div>
            )
          })
        }
      </div>
    )
  }

  renderSftpPanelTitle (type, username, host) {
    if (type === typeMap.remote) {
      return (
        <div className='sftp-panel-title pd1t pd1b pd1x alignright elli'>
          <ReloadOutlined
            className='mg1r pointer'
            onClick={this.handleReloadRemoteSftp}
          />
          {e('remote')}: {username}@{host}
        </div>
      )
    }
    return (
      <div className='sftp-panel-title pd1t pd1b pd1x'>
        {e('local')}
      </div>
    )
  }

  // 从系统文件选择器上传文件到当前远程目录。
  uploadFiles = async () => {
    const result = await window.api.openDialog({ properties: ['openFile', 'multiSelections'] })
    if (!result?.length || !this.remoteDom) return
    const files = await Promise.all(result.map(getLocalFileInfo))
    await this.remoteDom.doTransferSelected(null, files, this.state.remotePath, typeMap.remote)
  }

  // 将选中的远程文件下载到用户明确选择的本地目录。
  downloadFiles = async () => {
    const files = this.getSelectedFiles()
    if (!files.length || !this.remoteDom) return
    const result = await window.api.openDialog({ properties: ['openDirectory'] })
    const folder = result?.[0]
    if (folder) await this.remoteDom.doTransferSelected(null, files, folder, typeMap.local)
  }

  renderSection (type, style, width) {
    const {
      id
    } = this.state
    const arr = this.getFileList(type)
    const loading = this.state[`${type}Loading`]
    const { host, username } = this.props.tab
    const listProps = {
      store: window.store,
      id,
      type,
      parentItem: this.renderParentItem(type),
      ...this.props,
      ...pick(
        this,
        [
          'directions',
          'renderEmptyFile',
          'getFileProps',
          'defaultDirection',
          'modifier',
          'sort',
          'prefetchDirectory'
        ]
      ),
      sortProp: this.state[`sortProp.${type}`],
      sortDirection: this.state[`sortDirection.${type}`],
      width,
      fileList: arr,
      selectedFiles: this.state.selectedFiles,
      lastClickedFile: this.state.lastClickedFile
    }
    const addrProps = {
      host,
      type,
      handleUploadFromBrowser: this.handleUploadFromBrowser,
      ...pick(
        this,
        [
          'onChange',
          'onGoto',
          'gotoHome',
          'onInputFocus',
          'onInputBlur',
          'toggleShowHiddenFile',
          'goParent',
          'onClickHistory',
          'updateKeyword'
        ]
      ),
      ...pick(
        this.state,
        [
          `${type}ShowHiddenFile`,
          'onGoto',
          `${type}PathTemp`,
          `${type}Path`,
          `${type}PathHistory`,
          `${type}InputFocus`,
          'loadingSftp',
          `${type}Keyword`
        ]
      )
    }
    return (
      <div
        className={`sftp-section sftp-${type}-section tw-${type}`}
        style={style}
        key={type}
        {...style}
      >
        <Spin spinning={loading}>
          <div className='pd1 sftp-panel'>
            <div className='personal-file-toolbar'><span>{type === typeMap.remote ? '远程文件' : '本机文件'}</span>{type === typeMap.remote && <Space size={4}><Button size='small' onClick={() => this.uploadFiles()} disabled={!this.state.inited}>上传</Button><Button size='small' onClick={() => this.downloadFiles()} disabled={!this.getSelectedFiles().length}>下载</Button></Space>}</div>
            {
              this.renderSftpPanelTitle(type, username, host)
            }
            <AddressBar
              {...addrProps}
            />
            <div
              className={`file-list ${type} relative`}
            >
              <ListTable
                {...listProps}
              />
            </div>
          </div>
        </Spin>
      </div>
    )
  }

  // 只显示当前会话文件，左侧目录树按需展开。
  renderSections () {
    if (!this.isActive()) return null
    const { height, width } = this.props
    const type = this.shouldRenderRemote() ? typeMap.remote : typeMap.local
    const path = this.state[type + 'Path'] || '/'
    const list = this.getFileList(type)
    return <FileBrowser ready={this.state.inited} tabId={this.props.tab.id} key={type + (this.state.inited ? '-ready' : '-connecting')} width={width} height={height} currentPath={path} loading={this.state[type + 'Loading']} currentList={list} remote={type === typeMap.remote} listDirectory={(folder, refresh) => { const cache = this.getDirectoryCache(type); if (refresh) cache.invalidate(folder); return cache.read(folder) }} navigate={(folder, refresh = false) => this.navigateDirectory(type, folder, { refresh })} prefetchDirectory={folder => this.prefetchDirectory(type, folder)} onDirectoryAction={(action, folder, name) => this.directoryAction(type, action, folder, name)} renderFiles={fileWidth => this.renderSection(type, { width: fileWidth, height }, fileWidth)} />
  }

  // 目录树使用现有 SFTP 和本地文件接口，所有操作都针对右键选中的路径。
  directoryAction = async (type, action, folder, name) => {
    if (action === 'terminal') {
      const terminalPath = type === typeMap.remote ? folder.replace(/^\/([a-zA-Z]:)(.*)$/, (match, drive, rest) => drive + rest.replace(/\//g, '\\')) : folder
      refs.get('term-' + this.props.tab.id)?.cd(terminalPath)
      return
    }
    const remote = type === typeMap.remote
    const parent = resolve(folder, '..')
    const cache = this.getDirectoryCache(type)
    if (action !== 'create' && (folder === '/' || /^[a-z]:[\\/]?$/i.test(folder))) throw new Error('不能修改根目录')
    if (action === 'create') {
      const target = resolve(folder, name)
      if (remote) await this.sftp.mkdir(target)
      else await window.fs.mkdir(target)
      cache.invalidate(folder)
    } else if (action === 'rename') {
      const target = resolve(parent, name)
      if (remote) await this.sftp.rename(folder, target)
      else await window.fs.rename(folder, target)
      cache.invalidate(parent)
      return target
    } else if (action === 'delete') {
      if (remote) await this.sftp.rmdir(folder)
      else await window.fs.rmrf(folder)
      cache.invalidate(parent)
      return parent
    }
  }

  render () {
    const {
      id,
      ready
    } = this.state
    if (!ready) {
      return (
        <div className='pd3 aligncenter'>
          <LoadingOutlined />
        </div>
      )
    }
    const { height } = this.props
    const all = {
      className: 'sftp-wrap overhide relative',
      id: `id-${id}`,
      style: { height }
    }
    return (
      <div
        {...all}
      >
        {
          this.renderSections()
        }
      </div>
    )
  }
}
