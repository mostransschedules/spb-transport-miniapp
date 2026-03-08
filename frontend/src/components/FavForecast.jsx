// =============================================================================
// FavForecast — Компактный GPS-прогноз для пересадок
// =============================================================================
import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Кэш: stopId → { data, ts }
const _cache = {}
const _listeners = {}

const _load = async (stopId) => {
  try {
    const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
    if (!resp.ok) throw new Error()
    const data = await resp.json()
    _cache[stopId] = { data: data.forecasts || [], ts: Date.now() }
  } catch {
    _cache[stopId] = { data: [], ts: Date.now() - 25000 }
  }
  _listeners[stopId]?.forEach(fn => fn(_cache[stopId].data))
}

const subscribe = (stopId, cb) => {
  if (!_listeners[stopId]) _listeners[stopId] = new Set()
  _listeners[stopId].add(cb)
  if (_cache[stopId] && Date.now() - _cache[stopId].ts < 30000) {
    cb(_cache[stopId].data)
  } else {
    _load(stopId)
  }
  const iv = setInterval(() => _load(stopId), 30000)
  return () => { _listeners[stopId]?.delete(cb); clearInterval(iv) }
}

function FavForecast({ stopId, routeId, direction, compact = true }) {
  const [forecasts, setForecasts] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined') return
    const unsub = subscribe(stopId, setForecasts)
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(iv) }
  }, [stopId])

  if (!forecasts) return null

  const now = Math.floor(Date.now() / 1000)
  const upcoming = forecasts
    .filter(f => {
      if (f.arrival_time <= now) return false
      if (routeId && String(f.route_id) !== String(routeId)) return false
      // Фильтр по direction_id если задан
      if (direction !== undefined && direction !== null && f.direction_id !== undefined && f.direction_id !== null) {
        if (Number(f.direction_id) !== Number(direction)) return false
      }
      return true
    })
    .sort((a, b) => a.arrival_time - b.arrival_time)
    .slice(0, compact ? 2 : 4)
    .map(f => {
      const sec = f.arrival_time - now
      const min = Math.floor(sec / 60)
      const d = new Date(f.arrival_time * 1000)
      const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      return { timeStr, sec, min }
    })

  if (upcoming.length === 0) return null

  return (
    <div className="favforecast-compact">
      {upcoming.map((f, i) => (
        <span key={i} className="favforecast-chip">
          <span className="favforecast-dot" />
          <span className="favforecast-time">{f.timeStr}</span>
          <span className="favforecast-diff">{f.sec < 60 ? `${f.sec}с` : `${f.min}м`}</span>
        </span>
      ))}
    </div>
  )
}

export default FavForecast
