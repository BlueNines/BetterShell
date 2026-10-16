const { before, test } = require('node:test')
const assert = require('node:assert/strict')

let databaseLayout
let objectBrowserLayout

// 读取实际用于终端和分隔面板的统一尺寸计算。
before(async () => { ({ databaseLayout, objectBrowserLayout } = await import('../../client/components/mysql/layout.js')) })

// 显示、最小化和隐藏都必须占用恰好的总宽度。
test('MySQL panel layout fills the available width in every presentation', () => {
  assert.equal(databaseLayout(1000, 'expanded', 50).databaseWidth, 500)
  assert.equal(databaseLayout(1000, 'expanded', 70).databaseWidth, 300)
  assert.equal(databaseLayout(1000, 'minimized', 70).databaseWidth, 44)
  assert.equal(databaseLayout(1000, 'hidden', 70).shellWidth, 1000)
  for (const width of [1, 100, 320, 736, 1312]) {
    for (const mode of ['expanded', 'minimized', 'hidden']) {
      const layout = databaseLayout(width, mode, 99)
      assert.equal(layout.shellWidth + layout.databaseWidth, width)
      assert.ok(layout.shellWidth > 0)
      assert.ok(layout.databaseWidth >= 0)
    }
  }
})

// 极端比例受最小尺寸约束，恢复面板不会挤掉终端。
test('MySQL resize bounds preserve room for both panels', () => {
  assert.equal(databaseLayout(1000, 'expanded', 99).databaseWidth, 248)
  assert.equal(databaseLayout(1000, 'expanded', -50).shellWidth, 160)
  assert.equal(databaseLayout(1000, 'expanded', NaN).databaseWidth, 500)
})

// 长表名可自动拓宽，手动偏好在窗口缩小时受数据区最小宽度约束。
test('MySQL object browser adapts long names and preserves the data area', () => {
  const short = objectBrowserLayout(1000, 180)
  const long = objectBrowserLayout(1000, 480)
  assert.ok(long.treeWidth > short.treeWidth)
  assert.equal(objectBrowserLayout(1000, 480, 330).treeWidth, 330)
  assert.equal(objectBrowserLayout(500, 480, 600).treeWidth, 200)
  for (const width of [1, 320, 500, 1000]) {
    const layout = objectBrowserLayout(width, 700, 900)
    assert.ok(layout.treeWidth >= layout.minimum)
    assert.ok(width - layout.treeWidth >= layout.contentMinimum)
  }
})
