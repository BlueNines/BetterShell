// 用清晰占位区分 SQL NULL、空字符串、二进制和未加载的大字段。
export function cellText (value) {
  if (value === null) return 'NULL'
  if (value?.kind === 'binary') return `二进制 · ${value.bytes} B`
  if (value?.kind === 'omitted') return `未加载 · ${Math.ceil(value.bytes / 1024)} KiB`
  return String(value ?? '')
}

// 可导出的二进制保留 Base64，SQL NULL 使用可区分的标记。
export function exportText (value) {
  if (value?.kind === 'binary') return 'base64:' + value.base64
  if (value?.kind === 'omitted') return '[未加载字段]'
  return value === null ? null : String(value ?? '')
}

// CSV 字符串全部引用，NULL 独立标记，不把空字符串误当空值。
export function toCsv (result) {
  // 引号和换行都保留为标准 CSV 格式。
  function quote (value) { return '"' + String(value).replace(/"/g, '""') + '"' }
  const lines = [result.columns.map(column => quote(column.name)).join(',')]
  for (const row of result.rows) lines.push(row.map(value => value === null ? '\\N' : quote(exportText(value))).join(','))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

// 标识符转义仅用于生成可编辑的 SQL 草稿，提交操作仍由后端校验。
export function quoteName (value) { return '`' + value.replace(/`/g, '``') + '`' }
