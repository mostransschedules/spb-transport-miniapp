/**
 * История просмотров маршрутов и остановок
 */

const HISTORY_KEY = 'view-history'
const MAX_ITEMS = 100

/**
 * Получить историю
 */
export const getHistory = () => {
  try {
    const saved = localStorage.getItem(HISTORY_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

/**
 * Добавить маршрут в историю
 */
export const addRouteToHistory = (route) => {
  try {
    const history = getHistory()
    const item = {
      type: 'route',
      id: `route-${route.route_short_name}-${route.route_id || ''}`,
      routeName: route.route_short_name,
      routeLong: route.route_long_name || '',
      routeId: route.route_id,
      routeType: route.route_type,
      transportType: route.transport_type || 'bus',
      timestamp: Date.now()
    }
    // Удаляем дубликат если есть (по новому и старому формату ID)
    const filtered = history.filter(h => h.id !== item.id && h.id !== `route-${route.route_short_name}`)
    const updated = [item, ...filtered].slice(0, MAX_ITEMS)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {}
}

/**
 * Добавить остановку в историю
 */
export const addStopToHistory = (route, stop, direction, dayType) => {
  try {
    const history = getHistory()
    const item = {
      type: 'stop',
      id: `stop-${route.route_short_name}-${route.route_id || ''}-${stop.stop_name}-${direction}-${dayType}`,
      routeName: route.route_short_name,
      routeLong: route.route_long_name || '',
      routeId: route.route_id,
      routeType: route.route_type,
      transportType: route.transport_type || 'bus',
      stopName: stop.stop_name,
      direction,
      dayType,
      timestamp: Date.now()
    }
    // Удаляем дубликат (новый и старый формат)
    const oldId = `stop-${route.route_short_name}-${stop.stop_name}-${direction}-${dayType}`
    const filtered = history.filter(h => h.id !== item.id && h.id !== oldId)
    const updated = [item, ...filtered].slice(0, MAX_ITEMS)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {}
}

/**
 * Очистить историю
 */
export const clearHistory = () => {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {}
}

/**
 * Форматировать время для отображения
 */
export const formatHistoryTime = (timestamp) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  if (hours < 24) return `${hours} ч назад`
  if (days === 1) return 'вчера'
  return `${days} дн назад`
}
