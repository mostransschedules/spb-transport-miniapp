// =============================================================================
// FavForecastLabeled — GPS прогноз с меткой "GPS" для избранного/рядом
// =============================================================================
// Показывает ближайший рейс из GTFS-RT с меткой GPS.
// inline=true — компактная строчка для чипов маршрутов
// inline=false — блок с заголовком "GPS" для карточек избранного
// =============================================================================

import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Кэш по stopId чтобы не слать запросы для каждого чипа отдельно
const forecastCache = {}
const cacheListeners = {}

const subscribeToForecast = (stopId, cb) => {
  if (!cacheListeners[stopId]) cacheListeners[stopId] = new Set()
  cacheListeners[stopId].add(cb)

  const load = async () => {
    if (forecastCache[stopId] && Date.now() - forecastCache[stopId].ts < 30000) {
      cb(forecastCache[stopId].data)
      return
    }
    try {
      const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const forecasts = data.forecasts || []
      console.debug(`[FavForecast] stop=${stopId} → ${forecasts.length} рейсов`)
      forecastCache[stopId] = { data: forecasts, ts: Date.now() }
      cacheListeners[stopId]?.forEach(fn => fn(forecastCache[stopId].data))
    } catch (e) {
      console.debug(`[FavForecast] stop=${stopId} error:`, e.message)
      forecastCache[stopId] = { data: [], ts: Date.now() - 25000 } // retry soon
      cacheListeners[stopId]?.forEach(fn => fn([]))
    }
  }

  load()
  const interval = setInterval(load, 30000)
  return () => {
    cacheListeners[stopId]?.delete(cb)
    clearInterval(interval)
  }
}

function FavForecastLabeled({ stopId, routeId, inline = false }) {
  const [forecasts, setForecasts] = useState(null) // null = loading
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId) return
    const unsub = subscribeToForecast(stopId, setForecasts)
    const tickI = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(tickI) }
  }, [stopId])

  if (forecasts === null) return null // ещё грузим — ничего не показываем

  const now = Math.floor(Date.now() / 1000)
  const upcoming = forecasts
    .filter(f => {
      if (f.arrival_time <= now) return false
      if (!routeId) return true
      // Сравниваем числово — route_id может быть "123" или 123
      return String(f.route_id) === String(routeId)
    })
    .sort((a, b) => a.arrival_time - b.arrival_time)
    .slice(0, 2)
    .map(f => {
      const sec = f.arrival_time - now
      const min = Math.floor(sec / 60)
      const d = new Date(f.arrival_time * 1000)
      const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      return { timeStr, sec, min }
    })

  if (upcoming.length === 0) return null

  const first = upcoming[0]
  const countdownStr = first.sec < 60 ? `${first.sec}с` : `${first.min} мин`

  if (inline) {
    // Компактная строчка внутри чипа маршрута в Рядом
    return (
      <span className="nearby-gps-inline">
        <span className="nearby-label gps-label">GPS</span>
        {first.timeStr}
        {' '}
        <span className="nearby-gps-countdown">{countdownStr}</span>
      </span>
    )
  }

  // Блок для избранного
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color: '#4caf50',
        textTransform: 'uppercase', letterSpacing: '0.4px', minWidth: 70,
        background: 'rgba(39,174,96,0.08)', borderRadius: 3,
        padding: '1px 4px', border: '1px solid rgba(39,174,96,0.2)'
      }}>GPS</span>
      <span style={{ fontSize: 13 }}>
        <span style={{ color: '#4caf74', fontWeight: 600 }}>{first.timeStr}</span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}> · {countdownStr}</span>
      </span>
      {upcoming[1] && (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          {upcoming[1].timeStr} · {upcoming[1].min} мин
        </span>
      )}
    </div>
  )
}

export default FavForecastLabeled
