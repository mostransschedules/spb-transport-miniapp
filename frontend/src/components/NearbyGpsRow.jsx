// NearbyGpsRow — GPS/РАСПИСАНИЕ строка
// Кэш общий на stopId: один fetch на остановку, все карточки используют его
import { useState, useEffect } from 'react'
import vehiclesDb from '../vehicles.json'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ── Кэш и подписки ──────────────────────────────────────────────────────────
// _loading: защита от параллельных запросов к одному stopId
const _cache = {}     // stopId → { data, ts }
const _listeners = {} // stopId → Set<cb>
const _loading = {}   // stopId → boolean

const _load = async (stopId) => {
  if (_loading[stopId]) return          // уже грузится — не дублируем запрос
  _loading[stopId] = true
  try {
    const resp = await fetch(`${API_URL}/api/realtime/forecast/${stopId}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    _cache[stopId] = { data: data.forecasts || [], ts: Date.now() }
  } catch {
    _cache[stopId] = { data: null, ts: Date.now() - 5000 }
  } finally {
    _loading[stopId] = false
  }
  _listeners[stopId]?.forEach(fn => fn(_cache[stopId].data))
}

const subscribe = (stopId, cb) => {
  if (!_listeners[stopId]) _listeners[stopId] = new Set()
  _listeners[stopId].add(cb)

  const cached = _cache[stopId]
  if (cached && Date.now() - cached.ts < 30000) {
    cb(cached.data)
  } else {
    _load(stopId)
  }

  const iv = setInterval(() => _load(stopId), 30000)
  return () => {
    _listeners[stopId]?.delete(cb)
    clearInterval(iv)
  }
}

// ── Поиск модели ТС (как в LiveMap) ─────────────────────────────────────────
// Нормализация гос.номера: Latin → Cyrillic, убираем пробелы
const LATIN_TO_CYR = {A:'А',B:'В',E:'Е',K:'К',M:'М',H:'Н',O:'О',P:'Р',C:'С',T:'Т',Y:'У',X:'Х'}
const normPlate = (s) => {
  if (!s) return ''
  return (s + '').replace(/\s+/g, '').toUpperCase().split('').map(c => LATIN_TO_CYR[c] || c).join('')
}
const getPlateIdx = () => vehiclesDb.bus_plates || {}

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
  return vehiclesDb[key] || vehiclesDb[stripped] || null
}

const getModel = (vehicleId, label, licensePlate, typeHint) => {
  // Приоритет: гос.номер (точная идентификация) → бортовой → vehicleId
  if (licensePlate) {
    const norm = normPlate(licensePlate)
    if (norm.length > 3) {
      const found = getPlateIdx()[norm]
      if (found?.model) return found.model
    }
  }
  const info = lookupByLabel(label, typeHint) || lookupByLabel(vehicleId, typeHint)
  return info?.model || ''
}

// ── Компонент ────────────────────────────────────────────────────────────────
function NearbyGpsRow({ stopId, routeId, direction, transportType, usedVehicles }) {
  const [forecasts, setForecasts] = useState(undefined)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stopId || stopId === 'undefined' || stopId === 'none') {
      setForecasts(null)
      return
    }
    const unsub = subscribe(stopId, setForecasts)
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => { unsub(); clearInterval(iv) }
  }, [stopId])

  if (forecasts === undefined) return null

  const now = Math.floor(Date.now() / 1000)

  const gpsReis = forecasts
    ? forecasts.filter(f => {
        if (f.arrival_time <= now) return false
        if (String(f.route_id) !== String(routeId)) return false
        // direction_id из GTFS-RT СПб не приходит (trip_id пустой),
        // поэтому фильтруем только если он реально есть
        if (
          direction !== undefined && direction !== null &&
          f.direction_id !== undefined && f.direction_id !== null
        ) {
          if (Number(f.direction_id) !== Number(direction)) return false
        }
        return true
      }).sort((a, b) => a.arrival_time - b.arrival_time)
    : []

  // Берём первый рейс чей vehicle_id ещё не занят другой карточкой этой остановки.
  // usedVehicles — синхронный Set из App.jsx, общий для всех карточек одной остановки.
  let first = null
  for (const f of gpsReis) {
    const vid = f.vehicle_id || f.label || ''
    if (usedVehicles && usedVehicles.has(vid)) continue
    first = f
    if (usedVehicles && vid) usedVehicles.add(vid)
    break
  }
  const hasGps = first !== null

  const label = first?.label || ''
  const vehicleId = first?.vehicle_id || ''
  const licensePlate = first?.license_plate || ''
  const model = getModel(vehicleId, label, licensePlate, transportType)
  // DEBUG — убрать после диагностики
  // DEBUG убрать после диагностики

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
