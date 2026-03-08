// =============================================================================
// NearbyGpsRow — GPS строчка под маршрутом в "Остановках рядом"
// =============================================================================
// Показывает:
//   • [бортовой] · [расстояние] [GPS]     — если есть GPS данные
//   • РАСПИСАНИЕ  по графику               — если GPS нет
// =============================================================================
import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Общий кэш по stopId
const _cache = {}
const _listeners = {}

const _load = async (stopId) => {
  try {
    const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
    if (!resp.ok) throw new Error()
    const data = await resp.json()
    _cache[stopId] = { data: data.forecasts || [], ts: Date.now() }
  } catch {
    _cache[stopId] = { data: null, ts: Date.now() - 25000 }
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

function NearbyGpsRow({ stopId, routeId, schedDep }) {
  const [forecasts, setForecasts] = useState(undefined)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined') return
    const unsub = subscribe(stopId, setForecasts)
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(iv) }
  }, [stopId])

  const now = Math.floor(Date.now() / 1000)

  // Ещё загружается
  if (forecasts === undefined) {
    return (
      <div className="nearby-gps-row sched">
        <span className="nearby-gps-tag sched">РАСПИСАНИЕ</span>
        <span className="nearby-gps-text">
          {schedDep == null ? 'нет рейсов' : schedDep.diffMin === 0 ? 'сейчас' : 'по графику'}
        </span>
      </div>
    )
  }

  // GTFS-RT недоступен
  if (forecasts === null) {
    return (
      <div className="nearby-gps-row sched">
        <span className="nearby-gps-tag sched">РАСПИСАНИЕ</span>
        <span className="nearby-gps-text">по графику</span>
      </div>
    )
  }

  // Ищем ближайший GPS рейс для этого маршрута
  const gpsReis = forecasts
    .filter(f => f.arrival_time > now && String(f.route_id) === String(routeId))
    .sort((a, b) => a.arrival_time - b.arrival_time)

  if (gpsReis.length === 0) {
    // Нет GPS — показываем "РАСПИСАНИЕ по графику"
    return (
      <div className="nearby-gps-row sched">
        <span className="nearby-gps-tag sched">РАСПИСАНИЕ</span>
        <span className="nearby-gps-text">по графику</span>
      </div>
    )
  }

  const first = gpsReis[0]
  const sec = first.arrival_time - now
  const min = Math.floor(sec / 60)
  const vehicleId = first.vehicle_id || ''

  return (
    <div className="nearby-gps-row gps">
      <span className="nearby-gps-dot" />
      {vehicleId && <span className="nearby-gps-vehicle">{vehicleId}</span>}
      {vehicleId && <span className="nearby-gps-sep">·</span>}
      <span className="nearby-gps-time">
        {sec < 60 ? `${sec} с` : `${min} мин`}
      </span>
      <span className="nearby-gps-tag gps-tag">GPS</span>
    </div>
  )
}

export default NearbyGpsRow
