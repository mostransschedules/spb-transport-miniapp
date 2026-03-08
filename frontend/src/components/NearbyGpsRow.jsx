// NearbyGpsRow — GPS/РАСПИСАНИЕ строка точно по мокапу
// label = бортовой номер (из vehicle_positions кэша)
// model = модель ТС (из vehicles.json по label)
import { useState, useEffect } from 'react'
import vehiclesDb from '../vehicles.json'

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

// Ищем модель по бортовому номеру (label) в vehicles.json
const getModel = (label, typeHint) => {
  if (!label) return ''
  const id = String(label).trim()
  const dicts = typeHint === 'tram' ? [vehiclesDb.tram]
    : typeHint === 'trolley' ? [vehiclesDb.trolley]
    : [vehiclesDb.bus, vehiclesDb.tram, vehiclesDb.trolley]
  for (const d of dicts) {
    if (d?.[id]?.model) return d[id].model
  }
  return ''
}

function NearbyGpsRow({ stopId, routeId, direction, transportType }) {
  const [forecasts, setForecasts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined' || stopId === 'none') {
      setLoading(false)
      return
    }
    const unsub = subscribe(stopId, (data) => {
      setForecasts(data)
      setLoading(false)
    })
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(iv) }
  }, [stopId])

  const now = Math.floor(Date.now() / 1000)

  const gpsReis = (!loading && forecasts)
    ? forecasts.filter(f => {
        if (f.arrival_time <= now) return false
        if (String(f.route_id) !== String(routeId)) return false
        if (direction !== undefined && direction !== null
            && f.direction_id !== undefined && f.direction_id !== null) {
          if (Number(f.direction_id) !== Number(direction)) return false
        }
        return true
      }).sort((a, b) => a.arrival_time - b.arrival_time)
    : []

  const hasGps = gpsReis.length > 0
  const first = hasGps ? gpsReis[0] : null

  // label = бортовой номер (обогащён в main.py)
  const label = first?.label || ''
  const model = getModel(label, transportType)

  if (!hasGps) {
    return (
      <div className="ngps-row sched">
        <span className="ngps-tag sched">РАСПИСАНИЕ</span>
        <span className="ngps-label">по графику</span>
      </div>
    )
  }

  return (
    <div className="ngps-row gps">
      <span className="ngps-dot" />
      {label && <span className="ngps-vehicle">{label}</span>}
      {label && model && <span className="ngps-sep">·</span>}
      {model && <span className="ngps-model">{model}</span>}
      <span className="ngps-tag gps">GPS</span>
    </div>
  )
}

export default NearbyGpsRow
