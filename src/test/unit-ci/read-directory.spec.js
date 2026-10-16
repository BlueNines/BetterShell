const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { readDirectory } = require('../../app/common/read-directory')

// 只删除本测试通过 mkdtemp 创建并核对过绝对路径的临时目录。
async function removeTestDirectory (directory) {
  assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'bettershell-directory-')))
  await fs.rm(directory, { recursive: true, force: true })
}

// 整层结果必须保留中文、大小和目录类型，且只列举当前这一层。
test('batched local directory reads preserve metadata without scanning descendants', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bettershell-directory-'))
  try {
    await fs.mkdir(path.join(directory, '中文目录'))
    await fs.writeFile(path.join(directory, '中文目录', 'nested.txt'), 'nested', 'utf8')
    await fs.writeFile(path.join(directory, '中文.txt'), '中文', 'utf8')
    const rows = await readDirectory(directory)
    assert.equal(rows.length, 2)
    assert.equal(rows.find(file => file.name === '中文.txt').size, 6)
    assert.equal(rows.find(file => file.name === '中文目录').isDirectory, true)
    assert.equal(rows.some(file => file.name === 'nested.txt'), false)
    assert.ok(rows.every(file => Number.isFinite(file.modifyTime)))
  } finally { await removeTestDirectory(directory) }
})

// 大目录限制并发属性读取，并让不存在的目录明确失败，避免缓存成空目录。
test('batched local metadata reads bound concurrency and propagate directory errors', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bettershell-directory-'))
  const lstat = fs.lstat
  let active = 0
  let maximum = 0
  try {
    await Promise.all(Array.from({ length: 80 }, (_, index) => fs.writeFile(path.join(directory, String(index)), 'row', 'utf8')))
    fs.lstat = async (...args) => { active++; maximum = Math.max(maximum, active); try { return await lstat(...args) } finally { active-- } }
    assert.equal((await readDirectory(directory)).length, 80)
    assert.ok(maximum > 1 && maximum <= 16)
    await assert.rejects(readDirectory(path.join(directory, 'missing')), /ENOENT/)
  } finally { fs.lstat = lstat; await removeTestDirectory(directory) }
})
