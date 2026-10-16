const { before, test } = require('node:test')
const assert = require('node:assert/strict')

let sql

// 加载前后端共用的脚本拆分规则。
before(async () => { sql = await import('../../app/common/mysql-sql.mjs') })

// 字符串、标识符和注释里的分号不能拆开真实语句。
test('MySQL scripts preserve quoted and commented semicolons', () => {
  assert.equal(sql.splitSql("SELECT '中文;内容', 'it''s;ok', `a;b`; -- comment;\nSELECT 2 /* ; */;").length, 2)
  assert.equal(sql.splitSql("# 注释;\nSELECT 'a\\';b'; SELECT 3").length, 2)
  assert.throws(() => sql.splitSql("SELECT '未闭合"), /尚未结束/)
  assert.throws(() => sql.splitSql('/* 未闭合'), /尚未结束/)
  assert.throws(() => sql.splitSql('-- 只有注释'), /请输入/)
})

// 输出文件、可执行注释和写语句都必须经过用户确认。
test('MySQL write confirmation includes executable comments and file output', () => {
  assert.equal(sql.isReadSql('/* 普通注释 */ SELECT 1'), true)
  assert.equal(sql.isReadSql('SHOW TABLES'), true)
  assert.equal(sql.isReadSql("SELECT 1 INTO OUTFILE '/tmp/file'"), false)
  assert.equal(sql.isReadSql('/*!80000 DELETE FROM players */'), false)
  assert.equal(sql.isReadSql('SELECT 1 /*!80000 INTO OUTFILE "/tmp/file" */'), false)
  assert.equal(sql.isReadSql('UPDATE players SET online=1'), false)
  assert.throws(() => sql.splitSql('SELECT 1;'.repeat(21)), /最多执行 20/)
  assert.throws(() => sql.splitSql('x'.repeat(1024 * 1024 + 1)), /1 MiB/)
})
