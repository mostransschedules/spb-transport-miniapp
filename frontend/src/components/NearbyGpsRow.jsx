// NearbyGpsRow — GPS строчка под маршрутом (дизайн по мокапу)
import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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

function NearbyGpsRow({ stopId, routeId, direction, schedDep }) {
  const [forecasts, setForecasts] = useState(undefined)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined') return
    const unsub = subscribe(stopId, setForecasts)
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(iv) }
  }, [stopId])

  const now = Math.floor(Date.now() / 1000)

  // Загружается — сразу показываем РАСПИСАНИЕ
  if (forecasts === undefined || forecasts === null) {
    return (
      <div className="ngps-row sched">
        <span className="ngps-tag sched">РАСПИСАНИЕ</span>
        <span className="ngps-label">по графику</span>
      </div>
    )
  }

  // Ищем ближайший GPS рейс
  const gpsReis = forecasts
    .filter(f => {
      if (f.arrival_time <= now) return false
      if (String(f.route_id) !== String(routeId)) return false
      if (direction !== undefined && direction !== null
          && f.direction_id !== undefined && f.direction_id !== null) {
        if (Number(f.direction_id) !== Number(direction)) return false
      }
      return true
    })
    .sort((a, b) => a.arrival_time - b.arrival_time)

  if (gpsReis.length === 0) {
    return (
      <div className="ngps-row sched">
        <span className="ngps-tag sched">РАСПИСАНИЕ</span>
        <span className="ngps-label">по графику</span>
      </div>
    )
  }

  const first = gpsReis[0]
  const sec = first.arrival_time - now
  const min = Math.floor(sec / 60)
  const vehicleId = first.vehicle_id || ''

  return (
    <div className="ngps-row gps">
      <span className="ngps-dot" />
      {vehicleId && <span className="ngps-vehicle">{vehicleId}</span>}
      {vehicleId && <span className="ngps-sep">·</span>}
      <span className="ngps-time">
        {sec < 60 ? `${sec} с` : `${min} мин`}
      </span>
      <span className="ngps-tag gps">GPS</span>
    </div>
  )
}

export default NearbyGpsRow
