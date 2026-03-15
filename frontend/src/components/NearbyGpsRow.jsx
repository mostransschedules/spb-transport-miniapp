// NearbyGpsRow — GPS/РАСПИСАНИЕ строка точно по мокапу
// label = бортовой номер (из vehicle_positions кэша)
// model = модель ТС (из vehicles.json — тот же подход что в LiveMap)
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

// Тот же подход что в LiveMap: ищем по label/vehicle_id с учётом типа ТС
const lookupByLabel = (label, typeHint) => {
  if (!label) return null
  const key = String(label).trim()
  const stripped = key.replace(/^0+/, '') || key
  if (vehiclesDb.bus) {
    const order = typeHint
      ? [typeHint, ...['bus', 'tram', 'trolley'].filter(t => t !== typeHint)]
      : ['bus', 'tram', 'trolley']
    for (const t of order) {
      const db = vehiclesDb[t] || {}
      if (db[key]) return db[key]
      if (db[stripped]) return db[stripped]
    }
    return null
  }
  // Старый flat-формат
  return vehiclesDb[key] || vehiclesDb[stripped] || null
}

const lookupVehicle = (vehicleId, label, typeHint) => {
  return lookupByLabel(label, typeHint) || lookupByLabel(vehicleId, typeHint) || null
}

const getModel = (vehicleId, label, typeHint) => {
  const info = lookupVehicle(vehicleId, label, typeHint)
  return info?.model || ''
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

  // label = бортовой номер, vehicle_id = внутренний код — пробуем оба как в LiveMap
  const label = first?.label || ''
  const vehicleId = first?.vehicle_id || ''
  const model = getModel(vehicleId, label, transportType)

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
