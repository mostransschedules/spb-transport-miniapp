// ForecastBlock — Прогноз прибытия GTFS-RT
import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function ForecastBlock({ stopId }) {
  const [forecasts, setForecasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId) return
    let active = true
    const load = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
        if (!resp.ok) throw new Error()
        const data = await resp.json()
        if (active) { setForecasts(data.forecasts || []); setLoading(false) }
      } catch { if (active) setLoading(false) }
    }
    load()
    const iv = setInterval(load, 30000)
    const tick = setInterval(() => setTick(t => t + 1), 1000)
    return () => { active = false; clearInterval(iv); clearInterval(tick) }
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

  const tt2bg = t => t === 'tram' ? '#e74c3c' : t === 'trolley' ? '#3498db' : '#27ae60'

  return (
    <div className="fb-wrap">
      <div className="fb-header">
        <span className="sv2-section-label">ПРОГНОЗ ПРИБЫТИЯ</span>
        <span className="fb-live-dot" />
        <span className="fb-gtfs-label">GTFS-RT</span>
      </div>
      <div className="fb-list">
        {upcoming.map((f, i) => (
          <div key={`${f.route_id}-${f.trip_id}-${i}`} className={`fb-row${i === 0 ? ' fb-row-first' : ''}`}>
            <div className="fb-row-top">
              <span className="fb-chip" style={{ background: tt2bg(f.transport_type) }}>
                {f.route_short_name || '?'}
              </span>
              <span className="fb-time">{f.timeStr}</span>
              <span className={`fb-min${f.min <= 2 ? ' fb-min-now' : ''}`}>
                {f.sec < 60 ? `${f.sec}с` : f.min}
              </span>
              {f.sec >= 60 && <span className="fb-min-label">мин</span>}
            </div>
            <div className="fb-row-bot">
              {f.is_realtime ? (
                <>
                  <span className="fb-dot" />
                  <span className="fb-tag gps">GPS</span>
                </>
              ) : (
                <span className="fb-tag sched">РАСПИСАНИЕ</span>
              )}
              {(f.label || f.vehicle_id) && (
                <span className="fb-vehicle">{f.label || f.vehicle_id}</span>
              )}
              {f.delay_seconds > 0 && (
                <span className="fb-delay">+{Math.floor(f.delay_seconds / 60)} мин</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ForecastBlock
