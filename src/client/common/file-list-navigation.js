export const FILE_ROW_HEIGHT = 27
const nameOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// 文件与文件夹统一比较当前列，大小和时间按数值排序，同值时按名称稳定排列。
export function sortFileList (list, property = 'name', direction = 'asc') {
  const numeric = ['size', 'modifyTime', 'accessTime'].includes(property)
  const sign = direction === 'desc' ? -1 : 1
  return list.slice().sort((a, b) => {
    if (Boolean(a.isParent) !== Boolean(b.isParent)) return a.isParent ? -1 : 1
    const order = numeric
      ? (Number(a[property]) || 0) - (Number(b[property]) || 0)
      : nameOrder.compare(String(a[property] ?? ''), String(b[property] ?? ''))
    return sign * (order || nameOrder.compare(a.name, b.name))
  })
}

// 短时间连续输入组成前缀；重复单字母循环，查找覆盖未挂载的虚拟列表项。
export function findFilePrefix (files, previous, text, selectedId, now = Date.now()) {
  const key = text.normalize('NFKC').toLocaleLowerCase()
  const fresh = now - (previous?.time || 0) > 900
  const prefix = fresh || previous?.prefix === key ? key : (previous?.prefix || '') + key
  const selected = files.findIndex(file => file.id === selectedId)
  const cycle = fresh || prefix === key
  const start = Math.max(0, selected + Number(cycle))
  // 从当前选择处继续查找，越过末尾后回到开头。
  function find (value) {
    for (let offset = 0; offset < files.length; offset++) {
      const index = (start + offset) % files.length
      if (files[index].name.normalize('NFKC').toLocaleLowerCase().startsWith(value)) return index
    }
    return -1
  }
  const index = find(prefix)
  if (index >= 0 || prefix === key) return { prefix: prefix.slice(0, 128), time: now, index }
  return { prefix: key, time: now, index: find(key) }
}
