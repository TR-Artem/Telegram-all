import type { Daily } from './types'

export type SiteStats = {
  checks: number
  ok: number
  uptime: number | null
  avgMs: number | null
}

export function siteStats(id: string, daily: Daily): SiteStats {
  let checks = 0
  let ok = 0
  let msSum = 0

  for (const day of Object.values(daily)) {
    const row = day[id]
    if (row === undefined) continue
    checks += row.checks
    ok += row.ok
    msSum += row.msSum
  }

  return {
    checks,
    ok,
    uptime: checks > 0 ? ok / checks : null,
    avgMs: ok > 0 ? msSum / ok : null,
  }
}

export function formatUptime(uptime: number | null) {
  if (uptime === null) return '—'
  return `${(uptime * 100).toFixed(1).replace('.', ',')}%`
}

export function formatMs(ms: number | null) {
  if (ms === null) return '—'
  return `${Math.round(ms)} мс`
}

export function sslText(days: number) {
  if (days < 0) return `SSL истёк ${Math.abs(days)} дн. назад`
  if (days === 0) return 'SSL истекает сегодня'
  return `SSL ${days} дн.`
}
