// =============================================================================
// FavForecast — Компактный GPS-прогноз для избранного и «Рядом»
// =============================================================================
// Показывает ближайшие рейсы из GTFS-RT для конкретной остановки.
// Используется внутри карточек избранного и остановок рядом.
// =============================================================================

import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function FavForecast({ stopId, routeId, compact = true }) {
  const [forecasts, setForecasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!stopId) return
    let active = true

    const load = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const data = await resp.json()
        if (active) {
          setForecasts(data.forecasts || [])
          setLoading(false)
        }
      } catch {
        if (active) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 30000)
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000)

    return () => {
      active = false
      clearInterval(interval)
      clearInterval(tickInterval)
    }
  }, [stopId])

  if (loading || forecasts.length === 0) return null

  const now = Math.floor(Date.now() / 1000)

  // Фильтруем по маршруту если передан routeId
  const filtered = forecasts
    .filter(f => f.arrival_time > now)
    .filter(f => !routeId || String(f.route_id) === String(routeId))
    .sort((a, b) => a.arrival_time - b.arrival_time)
    .slice(0, compact ? 3 : 5)
    .map(f => {
      const sec = f.arrival_time - now
      const min = Math.floor(sec / 60)
      const time = new Date(f.arrival_time * 1000)
      const timeStr = `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`
      return { ...f, sec, min, timeStr }
    })

  if (filtered.length === 0) return null

  if (compact) {
    // Компактный вид: строчка с пузырьками времени
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#4caf50', display: 'inline-block',
          boxShadow: '0 0 4px #4caf50', flexShrink: 0
        }} />
        {filtered.map((f, i) => (
          <span
            key={`${f.route_id}-${f.trip_id}-${i}`}
            style={{
              background: i === 0 ? 'rgba(39,174,96,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${i === 0 ? 'rgba(39,174,96,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              padding: '2px 7px',
              fontSize: 12,
              fontWeight: i === 0 ? 700 : 400,
              color: i === 0 ? '#4caf74' : 'rgba(255,255,255,0.7)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {f.timeStr}
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
              {f.sec < 60 ? `${f.sec}с` : `${f.min}м`}
            </span>
          </span>
        ))}
      </div>
    )
  }

  // Полный вид (для карточек побольше)
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#4caf50', display: 'inline-block',
          boxShadow: '0 0 4px #4caf50'
        }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          GPS
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filtered.map((f, i) => (
          <div
            key={`${f.route_id}-${f.trip_id}-${i}`}
            style={{
              background: i === 0 ? 'rgba(39,174,96,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${i === 0 ? 'rgba(39,174,96,0.25)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 8,
              padding: '4px 10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#4caf74' : '#fff' }}>
              {f.timeStr}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
              {f.sec < 60 ? `${f.sec}с` : `${f.min} мин`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FavForecast
