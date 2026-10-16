const { test } = require('node:test')
const assert = require('node:assert/strict')

// 不同类型与字符串大小必须一起做数值排序，禁止恢复文件夹固定置顶。
test('file sizes sort numerically across files and folders', async () => {
  const { sortFileList } = await import('../../client/common/file-list-navigation.js')
  const files = [{ name: 'folder', size: 4, isDirectory: true }, { name: 'big', size: '100' }, { name: 'small', size: '2' }]
  assert.deepEqual(sortFileList(files, 'size').map(file => file.name), ['small', 'folder', 'big'])
  assert.deepEqual(sortFileList(files, 'size', 'desc').map(file => file.name), ['big', 'folder', 'small'])
  assert.deepEqual(files.map(file => file.name), ['folder', 'big', 'small'])
})

// 名称使用自然排序，文件夹的名字同样参与比较。
test('default name order handles numeric prefixes without grouping by type', async () => {
  const { sortFileList } = await import('../../client/common/file-list-navigation.js')
  const files = [{ name: 'zebra', isDirectory: true }, { name: 'File10' }, { name: 'file2' }, { name: 'alpha' }]
  assert.deepEqual(sortFileList(files).map(file => file.name), ['alpha', 'file2', 'File10', 'zebra'])
})

// 快速前缀可命中虚拟列表深处，同字母循环且能从尾部回到头部。
test('typeahead builds prefixes and cycles repeated letters', async () => {
  const { findFilePrefix } = await import('../../client/common/file-list-navigation.js')
  const files = ['alpha', 'apple', 'beta', 'zebra'].map((name, id) => ({ id, name }))
  let match = findFilePrefix(files, null, 'a', null, 1000)
  assert.equal(match.index, 0)
  match = findFilePrefix(files, match, 'a', 0, 1100)
  assert.equal(match.index, 1)
  match = findFilePrefix(files, match, 'p', 1, 1200)
  assert.equal(match.prefix, 'ap')
  assert.equal(match.index, 1)
  match = findFilePrefix(files, match, 'B', 1, 2500)
  assert.equal(match.index, 2)
  assert.equal(findFilePrefix(files, null, 'a', 3, 4000).index, 0)
  assert.equal(findFilePrefix(files, null, 'x', 3, 4000).index, -1)
})
