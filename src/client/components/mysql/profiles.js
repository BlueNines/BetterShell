// 收藏 ID 优先；历史或临时会话用稳定的服务器身份，不绑定随机标签 ID。
export function databaseOwner (tab, bookmarks = []) {
  if (tab.srcId) return tab.srcId
  if (!tab.host) return 'local'
  const identity = [tab.host.trim().toLowerCase(), Number(tab.port || 22), String(tab.username || '')]
  const bookmark = bookmarks.find(item => item.host && item.host.trim().toLowerCase() === identity[0] && Number(item.port || 22) === identity[1] && String(item.username || '') === identity[2])
  return bookmark?.id || 'server:' + JSON.stringify(identity)
}

// 只显示当前服务器的收藏，兼容旧版没有归属的直连配置。
export function availableDatabaseProfiles (profiles, owner) {
  return profiles.filter(item => {
    const profileOwner = item.shellBookmarkId || (item.mode === 'ssh' ? item.sshBookmarkId : '')
    return !profileOwner || profileOwner === owner
  })
}

// 初次打开优先选中最近使用的配置，旧配置没有时间字段时仍可直接显示。
export function defaultDatabaseProfile (profiles) {
  return profiles.reduce((selected, item) => !selected || (item.lastSelectedAt || 0) > (selected.lastSelectedAt || 0) ? item : selected, null)
}
