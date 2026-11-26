export type Site = {
  id: string
  name: string
  url: string
}

export type Check = {
  id: string
  ok: boolean
  status: number
  ms: number
  error: string
  sslDays?: number | null
}

export type Run = {
  time: string
  checks: Check[]
}

export type DayStats = {
  checks: number
  ok: number
  msSum: number
  sslDays?: number | null
}

export type Daily = Record<string, Record<string, DayStats>>

export type Results = {
  history: Run[]
  daily?: Daily
}
