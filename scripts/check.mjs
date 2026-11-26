import { readFile, writeFile } from 'node:fs/promises'
import tls from 'node:tls'

const SITES = 'public/data/sites.json'
const RESULTS = 'public/data/results.json'

// 30 минут × 48 = сутки истории для таблицы проверок.
const HISTORY_LIMIT = 48
// Сводка доступности хранится по дням за 30 дней.
const DAILY_LIMIT = 30
// Проверка повторов: алерт уходит только со второй ошибки подряд.
const FAILURES_TO_ALERT = 2
const FETCH_TIMEOUT = 15000
const SLOW_MS = 3000
const DAY = 24 * 60 * 60 * 1000
const MSK_OFFSET = 3 * 60 * 60 * 1000

const mskDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function dayKey(date) {
  return mskDay.format(date)
}

async function notify(text) {
  if (process.env.TELEGRAM_DRY_RUN === '1') {
    console.log(`Сообщение (dry run):\n${text}`)
    return
  }
  const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Секреты Telegram не заданы, сообщение не отправлено')
    return
  }
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  })
  console.log('Telegram:', response.status)
}

function sslDaysLeft(siteUrl) {
  let url
  try {
    url = new URL(siteUrl)
  } catch {
    return Promise.resolve(null)
  }
  if (url.protocol !== 'https:') {
    return Promise.resolve(null)
  }
  const host = url.hostname
  const port = Number(url.port) || 443

  return new Promise((resolve) => {
    let settled = false
    let socket
    const done = (value) => {
      if (settled) return
      settled = true
      if (socket) socket.destroy()
      resolve(value)
    }

    try {
      socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false, timeout: 10000 },
        () => {
          const cert = socket.getPeerCertificate()
          const end = Date.parse(cert?.valid_to ?? '')
          if (Number.isNaN(end)) {
            done(null)
            return
          }
          const diff = end - Date.now()
          // Просроченный сертификат отдаём отрицательным числом дней.
          done(diff >= 0 ? Math.ceil(diff / DAY) : -Math.ceil(-diff / DAY))
        },
      )
    } catch {
      done(null)
      return
    }

    socket.on('error', () => done(null))
    socket.on('timeout', () => done(null))
  })
}

async function checkSite(site) {
  const check = { id: site.id, ok: false, status: 0, ms: 0, error: '' }

  const sslDays = await sslDaysLeft(site.url)
  if (sslDays !== null) {
    check.sslDays = sslDays
  }

  const start = Date.now()
  try {
    const response = await fetch(site.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    check.status = response.status
    check.ok = response.ok
  } catch (e) {
    check.error = e.message
  }
  check.ms = Date.now() - start
  return check
}

function addToDaily(daily, time, check) {
  const key = dayKey(new Date(time))
  const day = (daily[key] ??= {})
  const row = (day[check.id] ??= { checks: 0, ok: 0, msSum: 0, sslDays: null })
  row.checks += 1
  if (check.ok) {
    row.ok += 1
    row.msSum += check.ms
  }
  if (typeof check.sslDays === 'number') {
    row.sslDays = check.sslDays
  }
}

function backfillDaily(history) {
  const daily = {}
  for (const run of [...history].reverse()) {
    for (const check of run.checks) {
      addToDaily(daily, run.time, check)
    }
  }
  return daily
}

function pruneDaily(daily, now) {
  const cutoff = dayKey(new Date(now.getTime() - (DAILY_LIMIT - 1) * DAY))
  for (const key of Object.keys(daily)) {
    if (key < cutoff) {
      delete daily[key]
    }
  }
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const parts = []
  if (days > 0) parts.push(`${days} д`)
  if (hours > 0) parts.push(`${hours} ч`)
  if (rest > 0 || parts.length === 0) parts.push(`${rest} мин`)
  return parts.join(' ')
}

function sslText(days) {
  if (days < 0) return `Сертификат истёк ${Math.abs(days)} дн. назад`
  if (days === 0) return 'Сертификат истекает сегодня'
  return `Осталось ${days} дн.`
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`
}

function buildDigest(sites, daily, checks, now) {
  const keys = []
  for (let i = 7; i >= 1; i -= 1) {
    keys.push(dayKey(new Date(now.getTime() - i * DAY)))
  }

  const rows = []
  for (const site of sites) {
    let total = 0
    let ok = 0
    let msSum = 0
    for (const key of keys) {
      const row = daily[key]?.[site.id]
      if (row === undefined) continue
      total += row.checks
      ok += row.ok
      msSum += row.msSum
    }
    if (total === 0) continue

    const current = checks.find((c) => c.id === site.id)
    const ssl = typeof current?.sslDays === 'number' ? current.sslDays : null
    rows.push({
      site,
      total,
      ok,
      uptime: ok / total,
      avgMs: ok > 0 ? msSum / ok : null,
      ssl,
    })
  }

  if (rows.length === 0) return null

  rows.sort((a, b) => a.uptime - b.uptime || a.site.name.localeCompare(b.site.name, 'ru'))
  const checksTotal = rows.reduce((sum, row) => sum + row.total, 0)

  const lines = rows.map((row) => {
    const icon = row.uptime === 1 ? '🟢' : row.uptime >= 0.99 ? '🟡' : '🔴'
    const avg = row.avgMs === null ? '—' : `${Math.round(row.avgMs)} мс`
    return `${icon} ${row.site.name} — ${formatPercent(row.uptime)}, ${avg}`
  })

  const failed = rows.filter((row) => row.uptime < 1).map((row) => row.site.name)
  const sslSoon = rows
    .filter((row) => typeof row.ssl === 'number' && row.ssl <= 14)
    .map((row) => `${row.site.name} — ${row.ssl} дн.`)

  const parts = [
    '📊 Итоги недели',
    '',
    `Проверок: ${checksTotal} · сайтов: ${rows.length}`,
    '',
    ...lines,
    '',
    failed.length > 0 ? `Простои были: ${failed.join(', ')}.` : 'Простоев не было.',
  ]
  if (sslSoon.length > 0) {
    parts.push(`SSL истекает: ${sslSoon.join('; ')}.`)
  }

  return parts.join('\n')
}

const sites = JSON.parse(await readFile(SITES, 'utf8'))

let history = []
let daily = null
let state = {}
let digest = { lastSent: null }
try {
  const saved = JSON.parse(await readFile(RESULTS, 'utf8'))
  history = Array.isArray(saved.history) ? saved.history : []
  daily = saved.daily && typeof saved.daily === 'object' ? saved.daily : null
  state = saved.state && typeof saved.state === 'object' ? saved.state : {}
  digest = saved.digest && typeof saved.digest === 'object' ? saved.digest : { lastSent: null }
} catch {
  // Первый запуск: файла с результатами ещё нет.
}

if (daily === null) {
  daily = backfillDaily(history)
}

const checks = await Promise.all(sites.map(checkSite))

for (const check of checks) {
  const site = sites.find((s) => s.id === check.id)
  const ssl = typeof check.sslDays === 'number' ? ` · SSL ${check.sslDays} дн.` : ''
  console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.status} ${check.ms} мс ${site.url}${ssl}`)
}

const now = new Date()
const time = now.toISOString()

history = [{ time, checks }, ...history].slice(0, HISTORY_LIMIT)
for (const check of checks) {
  addToDaily(daily, time, check)
}
pruneDaily(daily, now)

const changes = []

for (const check of checks) {
  const site = sites.find((s) => s.id === check.id)
  const s = (state[check.id] ??= { streak: 0, downSince: null, sslWarn: null })
  s.streak = Number(s.streak) || 0
  s.downSince = s.downSince ?? null
  s.sslWarn = s.sslWarn ?? null
  s.slow = s.slow === true

  if (!check.ok) {
    s.streak += 1
    if (s.downSince === null) {
      s.downSince = time
    }
    s.slow = false
    if (s.streak === FAILURES_TO_ALERT) {
      changes.push(`🔴 Не открывается: ${site.name} · ${check.status || check.error}\n${site.url}`)
    }
  } else {
    const recovered = s.streak >= FAILURES_TO_ALERT && s.downSince !== null
    if (recovered) {
      const duration = formatDuration(now.getTime() - Date.parse(s.downSince))
      changes.push(`🟢 Снова работает: ${site.name}\nЛежал ${duration}\n${site.url}`)
    }
    s.streak = 0
    s.downSince = null

    if (check.ms > SLOW_MS) {
      if (!recovered && !s.slow) {
        changes.push(`🟡 Медленно отвечает: ${site.name} · ${check.ms} мс\n${site.url}`)
      }
      s.slow = true
    } else {
      s.slow = false
    }
  }

  if (typeof check.sslDays === 'number') {
    const days = check.sslDays
    if (days > 14) {
      s.sslWarn = null
    } else if (days <= 7) {
      if (s.sslWarn !== 7) {
        s.sslWarn = 7
        changes.push(`🔴 SSL: ${site.name}\n${sslText(days)}\n${site.url}`)
      }
    } else if (s.sslWarn !== 14 && s.sslWarn !== 7) {
      s.sslWarn = 14
      changes.push(`🟠 SSL: ${site.name}\n${sslText(days)}\n${site.url}`)
    }
  }
}

if (changes.length === 0) {
  console.log('Изменений нет, сообщение не отправлено')
} else {
  await notify(`Проверка сайтов\n\n${changes.join('\n\n')}`)
}

const today = dayKey(now)
const mskNow = new Date(now.getTime() + MSK_OFFSET)
const digestDue =
  process.env.DIGEST_FORCE === '1' ||
  (mskNow.getUTCDay() === 1 && mskNow.getUTCHours() >= 9)

if (digestDue && digest.lastSent !== today) {
  const text = buildDigest(sites, daily, checks, now)
  if (text !== null) {
    await notify(text)
    digest.lastSent = today
  }
}

await writeFile(RESULTS, JSON.stringify({ history, daily, state, digest }, null, 2) + '\n')
