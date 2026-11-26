import type { Check } from './types'

export const SLOW_MS = 3000

export function statusText(check: Check | undefined) {
  if (check === undefined) {
    return 'Не проверялся'
  }
  if (check.ok) {
    const slow = check.ms > SLOW_MS ? ' · медленно' : ''
    return `Работает · ${check.ms} мс${slow}`
  }
  return `Не открывается · ${check.status || check.error}`
}
