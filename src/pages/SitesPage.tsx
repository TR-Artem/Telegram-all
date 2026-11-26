import { Link } from 'react-router'
import { useMonitoring } from '../monitoring'
import { formatMs, formatUptime, siteStats, sslText } from '../stats'
import { statusText } from '../status'

function SitesPage() {
  const { sites, history, daily, loading, error } = useMonitoring()
  const last = history[0]

  if (loading) {
    return <main className="main"><p className="empty">Загрузка сайтов…</p></main>
  }

  const checks = sites.map((site) => last?.checks.find((c) => c.id === site.id))
  const checked = checks.filter((check) => check !== undefined).length
  const failing = checks.filter((check) => check?.ok === false).length

  // Сводка не должна обещать больше, чем реально проверено: часть сайтов
  // в демо-списке ещё не опрашивалась.
  const summary =
    failing > 0
      ? `Не открываются: ${failing} из ${sites.length}`
      : checked < sites.length
        ? `Проверено ${checked} из ${sites.length} — все отвечают`
        : `Все ${sites.length} сайтов открываются`

  return (
    <main className="main">
      {error !== '' && <p className="load-error">{error}</p>}
      {last !== undefined && <p className="summary">{summary}</p>}
      <ul className="sites">
        {sites.map((site) => {
          const check = last?.checks.find((c) => c.id === site.id)
          const stats = siteStats(site.id, daily)
          return (
            <li key={site.id} className={check?.ok === false ? 'site site--bad' : 'site'}>
              <span className="site__status">{statusText(check)}</span>
              <h2>
                <Link to={`/site/${site.id}`}>{site.name}</Link>
              </h2>
              <a href={site.url} target="_blank" rel="noreferrer">
                {site.url}
              </a>
              <span className="site__meta">
                {stats.checks === 0
                  ? 'Статистика за 30 дней накапливается'
                  : `${formatUptime(stats.uptime)} за 30 дней · ${formatMs(stats.avgMs)}`}
                {typeof check?.sslDays === 'number' ? ` · ${sslText(check.sslDays)}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

export default SitesPage
