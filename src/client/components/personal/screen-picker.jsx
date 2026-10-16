import { useEffect, useRef, useState } from 'react'
import { Button, Popover, Spin } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { execCmd } from '../terminal/terminal-apis'
import { parseScreenSessions } from '../../../app/common/screen-sessions.mjs'
import { addScreenTab } from '../../common/screen-tabs'
import './console-group.styl'

// Shell 旁的加号读取服务端 screen 清单，已有会话直接切换，不重复连接。
export default function ScreenPicker ({ tab }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  useEffect(() => () => { alive.current = false }, [])

  // 通过独立 exec 读取当前 SSH 用户的会话，不打断原控制台里正在运行的程序。
  async function refresh () {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    setError('')
    try {
      const result = await execCmd(tab.id, 'LC_ALL=C screen -ls', 10000)
      if (result.timedOut) throw new Error('screen 清单读取超时')
      if (result.exitCode === 127 || /command not found|not found/i.test(result.stderr)) throw new Error('服务器尚未安装 GNU screen')
      const sessions = parseScreenSessions(result.stdout)
      if (!sessions.length && result.exitCode && !/no sockets|no screens/i.test(result.stdout + result.stderr)) throw new Error(result.stderr || '无法读取 screen 清单')
      if (alive.current) setItems(sessions)
    } catch (error) { if (alive.current) setError(error.message) } finally {
      pending.current = false
      if (alive.current) setLoading(false)
    }
  }

  // 新标签紧挨对应 Shell；已打开的会话直接切换到原顶层标签。
  function select (item) {
    try { addScreenTab(tab, item.id); setOpen(false) } catch (error) { setError(error.message) }
  }

  const content = <div className='screen-picker'><div className='screen-picker-heading'><strong>当前服务器的 screen</strong><Button size='small' type='text' icon={<ReloadOutlined />} aria-label='刷新 screen 列表' onClick={refresh} /></div>{loading ? <Spin size='small' /> : error ? <p className='screen-picker-error'>{error}</p> : !items.length ? <p>当前用户没有可连接的 screen</p> : items.map(item => <button className='screen-picker-item' key={item.id} onClick={() => select(item)}><span>{item.name}<small>{item.id}</small></span><em>{item.attached ? '已附着 · 共享连接' : '可连接'}</em></button>)}</div>
  return <Popover content={content} placement='rightTop' trigger='click' open={open} onOpenChange={value => { setOpen(value); if (value) refresh() }}><Button className='shell-screen-add' size='small' type='text' icon={<PlusOutlined />} aria-label={'添加 screen · ' + (tab.title || tab.host)} title='查找并连接当前服务器的 screen' disabled={tab.status !== 'success'} /></Popover>
}
