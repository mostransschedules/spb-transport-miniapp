// =============================================================================
// LIVEMAP — Живая карта транспорта (GTFS-RT) v5
// =============================================================================
// Логика определения типа ТС:
//   ПРИОРИТЕТ: label → vehicle_id → license_plate из GTFS → plate из JSON
//   + transport_type из GTFS (обогащается в backend по route_id)
//   Автобус = есть гос.номер (license_plate непустой)
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './LiveMap.css'
import vehiclesDb from '../vehicles.json'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// =============================================================================
// vehicles.json теперь структурирован: { bus: {...}, tram: {...}, trolley: {...} }
// =============================================================================
// Нормализация гос.номера: убираем пробелы + Latin омонимы → Cyrillic
// GTFS-RT может отдавать латинские P/H/E/K/M/C/O/A — визуально идентичны кириллическим
const LATIN_TO_CYR = {A:'А',B:'В',E:'Е',K:'К',M:'М',H:'Н',O:'О',P:'Р',C:'С',T:'Т',Y:'У',X:'Х'}
const normPlate = (s) => {
  if (!s) return ''
  return (s + '').replace(/\s+/g, '').toUpperCase().split('').map(c => LATIN_TO_CYR[c] || c).join('')
}

// Plate → info: используем предвычисленный индекс из vehicles.json
const getPlateIdx = () => vehiclesDb.bus_plates || {}

// Поиск по бортовому номеру с учётом типа ТС
const lookupByLabel = (label, typeHint) => {
  if (!label) return null
  const key = String(label).trim()
  const stripped = key.replace(/^0+/, '') || key

  // Новый формат: { bus: {...}, tram: {...}, trolley: {...} }
  if (vehiclesDb.bus) {
    // Если есть подсказка типа — ищем только в нём
    const order = typeHint
      ? [typeHint, ...['bus','tram','trolley'].filter(t=>t!==typeHint)]
      : ['bus','tram','trolley']
    for (const t of order) {
      const db = vehiclesDb[t] || {}
      if (db[key]) return db[key]
      if (db[stripped]) return db[stripped]
    }
    return null
  }
  // Старый формат flat
  return vehiclesDb[key] || vehiclesDb[stripped] || null
}

// =============================================================================
// ПРИОРИТЕТ: label → vehicle_id → license_plate из GTFS → plate из JSON
// transport_type из backend (уже обогащён по route_id)
// =============================================================================
const lookupVehicle = (vehicleId, label, licensePlate, typeHint) => {
  // 1. Гос.номер из GTFS-RT — самый точный (конкретная машина прямо сейчас)
  if (licensePlate) {
    const norm = normPlate(licensePlate)
    if (norm.length > 3) {
      const found = getPlateIdx()[norm]
      if (found) return found
    }
  }
  // 2. По бортовому номеру с hint типа
  return lookupByLabel(label, typeHint) || lookupByLabel(vehicleId, typeHint) || null
}

const COLORS = { bus: '#27ae60', trolley: '#3498db', tram: '#e74c3c' }

// Определяем тип ТС
const resolveType = (v) => {
  // transport_type из backend (обогащён по route_id из GTFS) — самый надёжный источник
  if (v.transport_type && v.transport_type !== 'bus') return v.transport_type

  // Ищем в vehicles.json
  const typeHint = v.transport_type || null
  const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate, typeHint)
  if (info?.type) return info.type

  // Если есть непустой гос.номер → автобус
  if (v.license_plate && normPlate(v.license_plate).length > 3) return 'bus'

  // Фоллбэк на transport_type из backend
  return v.transport_type || 'bus'
}

// =============================================================================
// Иконка маркера с номером маршрута
// =============================================================================
const createVehicleIcon = (type, bearing = 0, selected = false, routeNum = '') => {
  const color = COLORS[type] || COLORS.bus
  const size = selected ? 36 : 28
  const fs = routeNum.length > 3 ? 7 : routeNum.length > 2 ? 9 : 10
  return L.divIcon({
    html: `<div style="position:relative;width:${size}px;height:${size+8}px;opacity:1">
      <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%) rotate(${bearing}deg);
        width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
        border-bottom:7px solid ${color};opacity:0.85"></div>
      <div style="position:absolute;top:3px;left:0;width:${size}px;height:${size}px;border-radius:50%;
        background:${color};border:${selected?3:1.5}px solid ${selected?'#fff':'rgba(0,0,0,0.4)'};
        display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:800;
        color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)${selected?`,0 0 14px ${color}90`:''};
        line-height:1;letter-spacing:-0.5px">${routeNum}</div></div>`,
    className: 'vehicle-marker-icon',
    iconSize: [size, size+8],
    iconAnchor: [size/2, size/2+4],
    popupAnchor: [0, -(size/2+8)],
  })
}

function MapFitBounds({ positions }) {
  const map = useMap()
  const key = positions ? `${positions[0]}-${positions[positions.length-1]}` : ''
  useEffect(() => {
    if (!positions || positions.length < 2) return
    try { map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 15 }) } catch {}
  }, [key]) // eslint-disable-line
  return null
}

function VehiclePopup({ v, resolvedType }) {
  const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate, resolvedType)
  const plate = v.license_plate || info?.plate || ''
  const typeLabel = { tram: 'Трамвай', trolley: 'Троллейбус', bus: 'Автобус' }[resolvedType] || 'Автобус'
  return (
    <div className="vehicle-popup">
      <div className="vehicle-popup-id">{v.label || v.vehicle_id}</div>
      {v.route_short_name && <div className="vehicle-popup-route">Маршрут {v.route_short_name}</div>}
      <div className="vehicle-popup-speed">{v.speed} км/ч · ▲{Math.round(v.bearing||0)}°</div>
      <div className="vehicle-popup-model">{info?.model || 'Неизвестно'}</div>
      {plate && <div className="vehicle-popup-plate">{plate}</div>}
      <div className="vehicle-popup-type">{typeLabel}</div>
    </div>
  )
}

// =============================================================================
// Основной компонент
// =============================================================================
function LiveMap({ routeId, routeName, transportType, stops: propStops, onClose, direction = 0 }) {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [filterRoute, setFilterRoute] = useState(null)
  const [filterLoading, setFilterLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [shapeLine, setShapeLine] = useState([])
  const [, setTick] = useState(0)
  const intervalRef = useRef(null)

  const fetchVehicles = useCallback(async () => {
    try {
      const url = routeId
        ? `${API_URL}/api/realtime/vehicles?route_id=${routeId}`
        : `${API_URL}/api/realtime/vehicles`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error()
      const data = await resp.json()
      setVehicles(data.vehicles || [])
      setLastUpdate(new Date())
      setError(null)
      setLoading(false)
    } catch {
      setError('Не удалось загрузить позиции транспорта')
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    if (!routeId || !routeName) return
    fetch(`${API_URL}/api/route/${encodeURIComponent(routeName)}/shape?direction=${direction}&route_id=${routeId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setShapeLine(d.coordinates || []))
      .catch(() => {})
  }, [routeId, routeName, direction])

  useEffect(() => {
    fetchVehicles()
    if (autoRefresh) intervalRef.current = setInterval(fetchVehicles, 10000)
    const tickI = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(intervalRef.current); clearInterval(tickI) }
  }, [fetchVehicles, autoRefresh])

  const handleFilterByRoute = useCallback(async (num, rId) => {
    // Если тот же num И тот же rId — снимаем фильтр
    if (filterRoute?.num === num && filterRoute?.routeId === rId) { setFilterRoute(null); return }
    setFilterLoading(true)
    try {
      const [sr, sh] = await Promise.all([
        fetch(`${API_URL}/api/route/${encodeURIComponent(num)}/stops?direction=0${rId ? `&route_id=${rId}` : ''}`),
        fetch(`${API_URL}/api/route/${encodeURIComponent(num)}/shape?direction=0${rId ? `&route_id=${rId}` : ''}`),
      ])
      const stops = sr.ok ? await sr.json() : []
      const shapeData = sh.ok ? await sh.json() : { coordinates: [] }
      // Сохраняем routeId для точной фильтрации ТС
      setFilterRoute({ num, routeId: rId || null, stops: Array.isArray(stops) ? stops : [], shape: shapeData.coordinates || [] })
    } catch {
      setFilterRoute({ num, routeId: rId || null, stops: [], shape: [] })
    } finally {
      setFilterLoading(false)
    }
  }, [filterRoute])

  const secAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null
  const displayVehicles = filterRoute
    ? vehicles.filter(v => {
        if (filterRoute.routeId) return String(v.route_id) === String(filterRoute.routeId)
        return (v.route_short_name || '') === filterRoute.num
      })
    : vehicles

  const routeLine = filterRoute?.shape?.length > 0 ? filterRoute.shape
    : shapeLine.length > 0 ? shapeLine
    : (propStops?.length > 1 ? propStops.map(s => [s.stop_lat, s.stop_lon]) : [])

  const visibleStops = filterRoute?.stops?.length > 0 ? filterRoute.stops : (propStops || [])

  const lineColor = filterRoute
    ? (COLORS[resolveType(vehicles.find(v => v.route_short_name === filterRoute.num) || {})] || COLORS.bus)
    : (COLORS[transportType] || COLORS.bus)

  const defaultCenter = [59.9343, 30.3351]
  const mapCenter = vehicles.length > 0
    ? [vehicles[0].lat, vehicles[0].lon]
    : propStops?.length > 0
      ? [propStops[Math.floor(propStops.length/2)].stop_lat, propStops[Math.floor(propStops.length/2)].stop_lon]
      : defaultCenter

  return (
    <div className="livemap-container">
      <div className="livemap-header">
        <div className="livemap-header-left">
          {onClose && <button className="livemap-back" onClick={onClose}>‹ Назад</button>}
          <div>
            <div className="livemap-title">
              {filterRoute ? `Маршрут ${filterRoute.num} — фильтр`
                : routeName ? `Маршрут ${routeName} — Живая карта`
                : 'Все маршруты — Живая карта'}
            </div>
            <div className="livemap-subtitle">
              <span className="livemap-live-dot" />
              {displayVehicles.length} машин
              {secAgo !== null && ` · обн. ${secAgo}с назад`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {filterRoute && (
            <button className="livemap-filter-reset" onClick={() => setFilterRoute(null)}>
              ✕ Все маршруты
            </button>
          )}
          <button
            className={`livemap-refresh-btn ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(a => !a)}
          >{autoRefresh ? '🔄' : '⏸️'}</button>
        </div>
      </div>

      {filterLoading && (
        <div className="livemap-filter-loading">Загружаем маршрут {filterRoute?.num}...</div>
      )}

      {loading ? (
        <div className="livemap-loading"><div className="spinner" /><p>Загружаем позиции...</p></div>
      ) : error ? (
        <div className="livemap-error"><p>❌ {error}</p><button onClick={fetchVehicles}>Повторить</button></div>
      ) : (
        <MapContainer
          center={mapCenter}
          zoom={routeId ? 13 : 11}
          className="livemap-map"
          scrollWheelZoom
          touchZoom
          dragging
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />

          {routeLine.length > 1 && (
            <Polyline positions={routeLine} color={lineColor} weight={3.5} opacity={0.72} />
          )}

          {visibleStops.map((stop, i) => (
            <Marker key={`stop-${stop.stop_id || i}`}
              position={[stop.stop_lat, stop.stop_lon]}
              icon={L.divIcon({
                html: `<div style="width:8px;height:8px;border-radius:50%;background:rgba(91,155,247,0.75);border:1.5px solid rgba(91,155,247,0.4)"></div>`,
                className: 'stop-dot-icon', iconSize: [8,8], iconAnchor: [4,4],
              })}
            >
              <Popup><div style={{textAlign:'center',fontSize:12,color:'#fff'}}><strong>{stop.stop_name}</strong></div></Popup>
            </Marker>
          ))}

          {vehicles.map(v => {
            const type = resolveType(v)
            const vId = v.entity_id || v.vehicle_id
            const routeNum = v.route_short_name || routeName || ''
            const isFiltered = !!filterRoute && (
              filterRoute.routeId
                ? String(v.route_id) !== String(filterRoute.routeId)
                : routeNum !== filterRoute.num
            )
            const isSelected = selectedVehicle === vId
            // Полностью скрываем ТС других маршрутов при фильтре
            if (isFiltered) return null
            return (
              <Marker key={vId} position={[v.lat, v.lon]}
                icon={createVehicleIcon(type, v.bearing, isSelected, routeNum, false)}
                eventHandlers={{ click: () => {
                  setSelectedVehicle(isSelected ? null : vId)
                  if (!routeId && routeNum) handleFilterByRoute(routeNum, v.route_id || '')
                }}}
              >
                <Popup><VehiclePopup v={v} resolvedType={type} /></Popup>
              </Marker>
            )
          })}

          {filterRoute?.shape?.length > 1 && (
            <MapFitBounds positions={filterRoute.shape} />
          )}
        </MapContainer>
      )}

      {vehicles.length > 0 && (
        <div className="livemap-vehicles-list">
          <div className="livemap-list-header">
            Машины на линии ({displayVehicles.length}
            {filterRoute ? ` · маршрут ${filterRoute.num}` : ''})
          </div>
          {displayVehicles.slice(0, 20).map(v => {
            const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate, resolveType(v))
            const type = resolveType(v)
            const vId = v.entity_id || v.vehicle_id
            return (
              <div key={vId}
                className={`livemap-vehicle-item ${selectedVehicle === vId ? 'selected' : ''}`}
                onClick={() => setSelectedVehicle(selectedVehicle === vId ? null : vId)}
              >
                <span className="livemap-vehicle-dot" style={{background: COLORS[type]||COLORS.bus}} />
                <span className="livemap-vehicle-id">{v.label || v.vehicle_id}</span>
                {(v.route_short_name || routeName) && (
                  <span className="livemap-vehicle-route" style={{background: COLORS[type]||COLORS.bus}}>
                    {v.route_short_name || routeName}
                  </span>
                )}
                <span className="livemap-vehicle-model">{info?.model || 'Неизвестно'}</span>
                <span className="livemap-vehicle-speed">{v.speed} км/ч</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default LiveMap
