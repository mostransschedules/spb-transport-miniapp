// =============================================================================
// ForecastBlock — Прогноз прибытия GTFS-RT
// =============================================================================
// Показывается на странице расписания остановки
// Запрашивает stopforecast каждые 30 сек
// =============================================================================

import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function ForecastBlock({ stopId }) {
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
      } catch (e) {
        console.error('Forecast error:', e)
        if (active) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 30000)
    // Tick for countdown update every second
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000)

    return () => {
      active = false
      clearInterval(interval)
      clearInterval(tickInterval)
    }
  }, [stopId])

  if (loading || forecasts.length === 0) return null

  const now = Math.floor(Date.now() / 1000)
  const upcoming = forecasts
    .filter(f => f.arrival_time > now)
    .sort((a, b) => a.arrival_time - b.arrival_time)
    .slice(0, 8)
    .map(f => {
      const sec = f.arrival_time - now
      const min = Math.floor(sec / 60)
      const time = new Date(f.arrival_time * 1000)
      const timeStr = `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`
      return { ...f, min, timeStr, sec }
    })

  if (upcoming.length === 0) return null

  return (
    <div style={{ marginTop: 16 }}>
      <div className="sv2-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        ПРОГНОЗ ПРИБЫТИЯ
        <span style={{ width: 6, height: 6, borderRadius: 3, background: '#4caf50', display: 'inline-block', boxShadow: '0 0 4px #4caf50' }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>GTFS-RT</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {upcoming.map((f, i) => {
          const tt = f.transport_type || 'bus'
          const bgColor = tt === 'tram' ? '#e74c3c' : tt === 'trolley' ? '#3498db' : '#27ae60'
          const isLive = f.is_realtime
          return (
            <div key={`${f.route_id}-${f.trip_id}-${i}`} style={{
              background: i === 0 ? 'rgba(39,174,96,0.06)' : 'rgba(255,255,255,0.03)',
              border: '1px solid ' + (i === 0 ? 'rgba(39,174,96,0.15)' : 'rgba(255,255,255,0.06)'),
              borderRadius: 12, padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  background: bgColor, color: '#fff', padding: '3px 8px',
                  borderRadius: 6, fontSize: 13, fontWeight: 700, minWidth: 32, textAlign: 'center'
                }}>{f.route_short_name || '?'}</span>
                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{f.timeStr}</span>
                <span style={{
                  color: f.min <= 2 ? '#4caf74' : '#fff',
                  fontSize: f.min <= 2 ? 20 : 16, fontWeight: 700
                }}>
                  {f.sec < 60 ? `${f.sec}с` : `${f.min}`}
                </span>
                {f.sec >= 60 && (
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>мин</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                {isLive ? (
                  <>
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: '#4caf50' }} />
                    <span style={{
                      background: 'rgba(39,174,96,0.12)', color: '#4caf74',
                      fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600
                    }}>GPS</span>
                  </>
                ) : (
                  <span style={{
                    background: 'rgba(243,156,18,0.12)', color: '#f39c12',
                    fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600
                  }}>РАСПИСАНИЕ</span>
                )}
                {f.vehicle_id && (
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{f.vehicle_id}</span>
                )}
                {f.delay_seconds > 0 && (
                  <span style={{ color: '#f39c12', fontSize: 10 }}>+{Math.floor(f.delay_seconds / 60)} мин</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ForecastBlock
