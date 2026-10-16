// 按 MySQL 的引号和注释边界拆分 SQL，不拆开字符串里的分号。
export function splitSql (sql) {
  if (typeof sql !== 'string' || sql.length > 1024 * 1024) throw new Error('SQL 不能为空或超过 1 MiB')
  const statements = []
  let start = 0
  let quote = ''
  let comment = ''
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]
    if (comment === 'line') {
      if (char === '\n') comment = ''
      continue
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') { comment = ''; i++ }
      continue
    }
    if (quote) {
      if (char === '\\') { i++; continue }
      if (char === quote) {
        if (next === quote) i++
        else quote = ''
      }
      continue
    }
    if (char === '#' || (char === '-' && next === '-' && /\s|^$/.test(sql[i + 2] || ''))) { comment = 'line'; continue }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === ';') {
      const statement = sql.slice(start, i).trim()
      if (statement) statements.push(statement)
      start = i + 1
    }
  }
  if (quote || comment === 'block') throw new Error('SQL 中的引号或注释尚未结束')
  const tail = sql.slice(start).trim()
  if (tail) statements.push(tail)
  const result = statements.filter(statement => sqlCommand(statement))
  if (!result.length) throw new Error('请输入需要执行的 SQL')
  if (result.length > 20) throw new Error('每次最多执行 20 条 SQL')
  return result
}

// 跳过普通的开头注释；可执行的 MySQL 版本注释保持为未知命令。
export function sqlCommand (sql) {
  const plain = sql.replace(/^(?:\s+|#[^\n]*(?:\n|$)|--\s[^\n]*(?:\n|$)|\/\*(?!!)[\s\S]*?\*\/)+/, '').trim()
  return plain.match(/^[A-Za-z]+/)?.[0].toUpperCase() || (plain ? 'UNKNOWN' : '')
}

// 普通读取语句可直接执行；可能改变数据或文件的 SQL 需要明确确认。
export function isReadSql (sql) {
  return ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(sqlCommand(sql)) && !/\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i.test(sql) && !/\/\*!/.test(sql)
}
