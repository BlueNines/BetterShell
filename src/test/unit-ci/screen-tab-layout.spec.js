const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 直接运行生产 helper；只替换模块导入，不启动界面或网络。
function model (tabs, activeTabId) {
  let saves = 0
  const store = { tabs, activeTabId, changeActiveTabId (id) { this.activeTabId = id }, scheduleWorkspaceSave () { saves++ } }
  const source = fs.readFileSync(path.resolve(__dirname, '../../client/common/screen-tabs.js'), 'utf8').replace(/^import[^\r\n]*\r?\n/gm, '').replace(/export function /g, 'function ')
  const sandbox = { window: { store }, module: { exports: {} }, Map }
  vm.runInNewContext(source + '\nmodule.exports = { toggleScreenTabs, visibleScreenTabs };', sandbox)
  return { store, helper: sandbox.module.exports, saves: () => saves }
}

// 收起不移除 screen；另一台服务器的 screen 和无父标签的 screen 均继续显示。
test('collapsed screen groups hide only their own labels and preserve consoles', () => {
  const tabs = [{ id: 'a', screenTabsExpanded: false }, { id: 'a1', screenSourceId: 'a', screenSession: '1.main' }, { id: 'b' }, { id: 'b1', screenSourceId: 'b', screenSession: '2.main' }, { id: 'orphan', screenSourceId: 'closed', screenSession: '3.main' }]
  const { helper } = model(tabs, 'a')
  assert.deepEqual(Array.from(helper.visibleScreenTabs(tabs), item => item.tab.id), ['a', 'b', 'b1', 'orphan'])
  assert.equal(tabs.length, 5)
  assert.equal(helper.visibleScreenTabs(tabs).find(item => item.tab.id === 'b1').index, 3)
})

// 从正在查看的 screen 收起时回到其 Shell，展开时保留选中状态并保存偏好。
test('pull toggles existing labels without opening or closing any tab', () => {
  const tabs = [{ id: 'a' }, { id: 'a1', screenSourceId: 'a', screenSession: '1.main' }]
  const { store, helper, saves } = model(tabs, 'a1')
  helper.toggleScreenTabs(tabs[0])
  assert.equal(tabs[0].screenTabsExpanded, false)
  assert.equal(store.activeTabId, 'a')
  assert.equal(tabs.length, 2)
  helper.toggleScreenTabs(tabs[0])
  assert.equal(tabs[0].screenTabsExpanded, true)
  assert.equal(saves(), 2)
})
