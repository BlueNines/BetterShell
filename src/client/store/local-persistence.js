import { debounce } from 'lodash-es'
import { update } from '../common/db'

// 只记录本地修改时间，个人版不连接任何云同步服务。
export default function localPersistence (Store) {
  // 合并连续写入，保存本地修改时间。
  Store.prototype.updateLastDataUpdateTime = debounce(async function () {
    window.store.lastDataUpdateTime = Date.now()
    await update('lastDataUpdateTime', window.store.lastDataUpdateTime)
  }, 300)
}
