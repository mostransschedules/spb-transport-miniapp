import React from 'react'
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf50',
        boxShadow: '0 0 4px #4caf5088', flexShrink: 0, display: 'inline-block' }} />
      {upcoming.map((f, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>·</span>}
          <span style={{ fontSize: 13, color: '#4caf74', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {f.timeStr}{' '}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
              {f.sec < 60 ? `${f.sec}с` : `${f.min}м`}
            </span>
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

export default FavForecast
