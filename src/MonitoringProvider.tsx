import { useEffect, useState, type ReactNode } from 'react'
import { MonitoringContext } from './monitoring'
import type { Daily, Results, Site } from './types'

async function loadJson(name: string, fresh = false) {
  const query = fresh ? `?t=${Date.now()}` : ''
  const response = await fetch(`${import.meta.env.BASE_URL}data/${name}${query}`)
  if (!response.ok) {
    throw new Error(`Файл ${name} не загрузился: код ${response.status}.`)
  }
  return response.json()
}

function MonitoringProvider({ children }: { children: ReactNode }) {
  const [sites, setSites] = useState<Site[]>([])
  const [history, setHistory] = useState<Results['history']>([])
  const [daily, setDaily] = useState<Daily>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const list: Site[] = await loadJson('sites.json')
        const results: Results = await loadJson('results.json', true)
        if (!ignore) {
          setSites(list)
          setHistory(results.history)
          setDaily(results.daily ?? {})
        }
      } catch (e) {
        if (!ignore) {
          setError((e as Error).message)
        }
      }
      if (!ignore) {
        setLoading(false)
      }
    }
    load()
    return () => {
      ignore = true
    }
  }, [])

  return (
    <MonitoringContext value={{ sites, history, daily, loading, error }}>{children}</MonitoringContext>
  )
}

export default MonitoringProvider
