import { useEffect, useState } from 'react'
import { CloudServerOutlined, ArrowUpOutlined, ArrowDownOutlined, HddOutlined } from '@ant-design/icons'
import { useRemoteMonitor } from '../remote-monitor/session-monitor'
import { formatBytes, formatRate, selectPrimaryNetwork } from '../remote-monitor/monitor-model'

const GROUPS = ['sysinfo', 'cpu', 'memory', 'network', 'uptime', 'disks', 'activities', 'load']

// 复用固定长度采样，在 SVG 中绘制折线和轻量背景网格。
function Chart ({ values, ceiling = 100, label = '最近采样趋势' }) {
  const maximum = Math.max(1, ceiling)
  const points = values.map((value, index) => `${index * 208 / Math.max(1, values.length - 1)},${42 - Math.min(maximum, Math.max(0, value)) * 36 / maximum}`).join(' ')
  return <svg className='personal-chart' viewBox='0 0 208 48' preserveAspectRatio='none' role='img' aria-label={label}><path className='personal-chart-grid' d='M0 12H208 M0 28H208 M0 44H208' /><polyline points={points} fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' /></svg>
}

// 一致的进度条展示资源占用，异常高的数值突出显示。
function Meter ({ percent }) {
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  return <div className={'personal-meter ' + (value >= 90 ? 'critical' : '')}><i style={{ width: value + '%' }} /></div>
}

// 缺失数据使用占位符，不表示成零。
function percentText (value) {
  return Number.isFinite(value) ? value.toFixed(1) + '%' : '—'
}

// 仅订阅正在查看的已连接会话，限制折线和进程数量。
export default function PersonalMonitor ({ tab }) {
  const connected = Boolean(tab?.host && tab.status === 'success')
  const snapshot = useRemoteMonitor(tab?.id || '', GROUPS, connected)
  const [networkHistory, setNetworkHistory] = useState([])
  const groups = snapshot.groups
  const network = selectPrimaryNetwork(groups.network.data)
  const uploadRate = formatRate(network?.txRate)
  const downloadRate = formatRate(network?.rxRate)
  useEffect(() => { setNetworkHistory([]) }, [tab?.id])
  useEffect(() => {
    if (groups.network.status === 'ready' && network) setNetworkHistory(history => [...history, (network.rxRate || 0) + (network.txRate || 0)].slice(-45))
  }, [groups.network.updatedAt])
  const cpu = groups.cpu.data
  const memory = groups.memory.data
  const uptime = groups.uptime.data
  const activities = (groups.activities.data || []).slice(0, 8)
  const disks = (groups.disks.data || []).slice(0, 5)
  const status = connected ? '在线' : tab?.host ? tab.status === 'error' ? '连接失败' : '未连接' : '待连接'
  return (
    <>
      <div className='personal-panel-heading'><span>运行状态</span><span className={'personal-state-pill ' + (connected ? 'online' : '')}><i />{status}</span></div>
      <div className='personal-monitor-body'>
        <div className='personal-host'><div className='personal-host-icon'><CloudServerOutlined /></div><div><strong title={tab?.title || tab?.host}>{tab?.host ? tab.title || tab.host : '选择一台服务器'}</strong><small title={tab?.host}>{tab?.host || '连接后查看实时资源'}</small></div></div>
        <p className='personal-os' title={groups.sysinfo.data?.os}>{groups.sysinfo.data?.os || (tab?.host ? '等待系统信息' : 'SSH · 终端与文件管理')}</p>
        <div className='personal-overview'><div><span>运行时间</span><strong>{uptime ? `${Math.floor(uptime.seconds / 86400)} 天 ${Math.floor(uptime.seconds % 86400 / 3600)} 小时` : '—'}</strong></div><div><span>负载 · 1 / 5 / 15 分钟</span><strong>{groups.load.data?.map(value => value.toFixed(2)).join(' · ') || '—'}</strong></div></div>
        <section className='personal-resource-card personal-cpu-card'><div className='personal-card-label'><span>CPU</span><small>使用率</small></div><div className='personal-resource-value'>{percentText(cpu)}</div><Chart values={snapshot.cpuHistory.map(point => point.value)} label='CPU 使用率趋势' /></section>
        <section className='personal-resource-card personal-memory-card'><div className='personal-card-label'><span>内存</span><strong>{percentText(memory?.percent)}</strong></div><Meter percent={memory?.percent} /><div className='personal-resource-detail'><span>{memory ? formatBytes(memory.usedBytes) + ' 已用' : '等待读取'}</span><span>{memory ? formatBytes(memory.totalBytes) + ' 总计' : '—'}</span></div><div className='personal-swap'>交换空间<span>{memory?.swapUsedBytes !== null && memory?.swapUsedBytes !== undefined ? `${formatBytes(memory.swapUsedBytes)} / ${formatBytes(memory.swapTotalBytes)}` : '—'}</span></div></section>
        <section className='personal-resource-card'><div className='personal-card-label'><span>网络</span><small>{network?.name || '实时速率'}</small></div><div className='personal-network'><div><span><ArrowUpOutlined /> 上传</span><strong title={uploadRate}>{uploadRate}</strong></div><div><span><ArrowDownOutlined /> 下载</span><strong title={downloadRate}>{downloadRate}</strong></div></div><Chart values={networkHistory} ceiling={Math.max(1024, ...networkHistory)} label='网络总流量趋势' /></section>
        <section className='personal-resource-card'><div className='personal-card-label'><span>磁盘</span><HddOutlined /></div>{disks.map(disk => <div className='personal-disk' key={disk.mount}><div><span title={disk.mount}>{disk.mount}</span><strong>{disk.percent}%</strong></div><Meter percent={disk.percent} /><small>{formatBytes(disk.availableBytes)} 可用 · 共 {formatBytes(disk.totalBytes)}</small></div>)}{!disks.length && <div className='personal-empty-note'>等待读取磁盘</div>}</section>
        <details className='personal-resource-card personal-process-card' open><summary>活跃进程<small>按 CPU 排序</small></summary>{activities.map(process => <div className='personal-process' key={process.pid}><div><strong title={process.cmd}>{process.cmd}</strong><small>PID {process.pid} · {formatBytes(process.memBytes)}</small></div><span>{process.cpu.toFixed(1)}%</span></div>)}{!activities.length && <div className='personal-empty-note'>{connected ? '等待读取进程' : '连接后显示'}</div>}</details>
      </div>
    </>
  )
}
