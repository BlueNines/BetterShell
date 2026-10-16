const { test } = require('node:test')
const assert = require('node:assert/strict')

// 拖动判定不依赖 DOM，验证边界容差和现有标签排序即可。
test('small vertical movements keep a tab in the bar, clear exits detach it', async () => {
  const { isOutsideTabBar } = await import('../../client/common/personal-tab-drag.js')
  const bounds = { left: 220, top: 44, right: 1200, bottom: 80 }
  for (const point of [{ clientX: 500, clientY: 62 }, { clientX: 500, clientY: 87 }]) assert.equal(isOutsideTabBar(point, bounds), false)
  for (const point of [{ clientX: 500, clientY: 120 }, { clientX: 200, clientY: 62 }, { clientX: 1220, clientY: 62 }]) assert.equal(isOutsideTabBar(point, bounds), true)
})

// 从数组前后两端移动都必须使用移除源标签后的插入位置。
test('reordering supports either half of a tab and the final blank area', async () => {
  const { getTabDropIndex } = await import('../../client/common/personal-tab-drag.js')
  const tabs = ['shell', 'screen-a', 'screen-b'].map(id => ({ id }))
  assert.equal(getTabDropIndex(tabs, 'shell', 'screen-b', true), 2)
  assert.equal(getTabDropIndex(tabs, 'screen-b', 'shell', false), 0)
  assert.equal(getTabDropIndex(tabs, 'screen-b', 'shell', true), 1)
  assert.equal(getTabDropIndex(tabs, 'shell', null), 2)
  assert.equal(getTabDropIndex(tabs, 'screen-a', 'screen-a'), -1)
  assert.equal(getTabDropIndex(tabs, 'missing', 'shell'), -1)
  assert.deepEqual(tabs.map(tab => tab.id), ['shell', 'screen-a', 'screen-b'])
})
