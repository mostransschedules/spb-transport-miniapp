// =============================================================================
// FavForecastLabeled — GPS прогноз с меткой "GPS" для избранного/рядом
// =============================================================================
import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Общий кэш по stopId — один запрос на остановку, все маршруты используют его
const forecastCache = {}
const cacheListeners = {}

const loadForecast = async (stopId) => {
  try {
    const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const forecasts = data.forecasts || []
    forecastCache[stopId] = { data: forecasts, ts: Date.now() }
    cacheListeners[stopId]?.forEach(fn => fn(forecasts))
  } catch (e) {
    // Если GTFS-RT недоступен — кэшируем пустой результат, повторим через 60с
    forecastCache[stopId] = { data: null, ts: Date.now() - 30000 }
    cacheListeners[stopId]?.forEach(fn => fn(null))
  }
}

const subscribeToForecast = (stopId, cb) => {
  if (!cacheListeners[stopId]) cacheListeners[stopId] = new Set()
  cacheListeners[stopId].add(cb)

  // Используем кэш если свежий (< 30 сек)
  if (forecastCache[stopId] && Date.now() - forecastCache[stopId].ts < 30000) {
    cb(forecastCache[stopId].data)
  } else {
    loadForecast(stopId)
  }

  // Обновляем каждые 30 сек
  const interval = setInterval(() => loadForecast(stopId), 30000)
  return () => {
    cacheListeners[stopId]?.delete(cb)
    clearInterval(interval)
  }
}

function FavForecastLabeled({ stopId, routeId, inline = false }) {
  const [forecasts, setForecasts] = useState(undefined) // undefined = загружаем
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined' || stopId === 'null') return
    const unsub = subscribeToForecast(stopId, setForecasts)
    const tickI = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(tickI) }
  }, [stopId])

  // Ещё загружаем или GTFS-RT недоступен
  if (forecasts === undefined || forecasts === null) return null

  const now = Math.floor(Date.now() / 1000)

  // Сначала ищем рейсы для конкретного маршрута
  const byRoute = routeId
    ? forecasts.filter(f => f.arrival_time > now && String(f.route_id) === String(routeId))
    : forecasts.filter(f => f.arrival_time > now)

  // Если для маршрута ничего нет — показываем ближайший GPS с остановки
  const allUpcoming = forecasts.filter(f => f.arrival_time > now)
  const sourceList = byRoute.length > 0 ? byRoute : allUpcoming

  const upcoming = sourceList
    .sort((a, b) => a.arrival_time - b.arrival_time)
    .slice(0, 2)
    .map(f => {
      const sec = f.arrival_time - now
      const min = Math.floor(sec / 60)
      const d = new Date(f.arrival_time * 1000)
      const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      return { timeStr, sec, min, routeName: f.route_short_name || '' }
    })

  if (upcoming.length === 0) return null

  const first = upcoming[0]
  const countdownStr = first.sec < 60 ? `${first.sec}с` : `${first.min} мин`
  // Если GPS рейс не для нашего маршрута — показываем номер маршрута
  const isForeignRoute = byRoute.length === 0 && routeId

  if (inline) {
    return (
      <span className="nearby-gps-inline">
        <span className="nearby-label gps-label">GPS</span>
        {isForeignRoute && first.routeName && (
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{first.routeName} </span>
        )}
        {first.timeStr}
        {' '}
        <span className="nearby-gps-countdown">{countdownStr}</span>
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color: '#4caf50',
        textTransform: 'uppercase', letterSpacing: '0.4px',
        background: 'rgba(39,174,96,0.1)', borderRadius: 3,
        padding: '1px 5px', border: '1px solid rgba(39,174,96,0.25)',
        whiteSpace: 'nowrap'
      }}>GPS</span>
      <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
        {isForeignRoute && first.routeName && (
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>({first.routeName})</span>
        )}
        <span style={{ color: '#4caf74', fontWeight: 600 }}>{first.timeStr}</span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>· {countdownStr}</span>
        {upcoming[1] && (
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
            · {upcoming[1].timeStr} · {upcoming[1].min} мин
          </span>
        )}
      </span>
    </div>
  )
}

export default FavForecastLabeled
