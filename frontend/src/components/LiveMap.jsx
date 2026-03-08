// =============================================================================
// LIVEMAP — Живая карта транспорта (GTFS-RT) v3
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './LiveMap.css'
import vehiclesDb from '../vehicles.json'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// =============================================================================
// Нормализация гос.номера: "С 438 ХС 198" → "С438ХС198"
// =============================================================================
const normPlate = (s) => (s || '').replace(/\s+/g, '').toUpperCase()

let _plateIndex = null
const getPlateIndex = () => {
  if (_plateIndex) return _plateIndex
  _plateIndex = {}
  for (const [, info] of Object.entries(vehiclesDb)) {
    if (info.plate) {
      const key = normPlate(info.plate)
      if (key) _plateIndex[key] = info
    }
  }
  return _plateIndex
}

// label → vehicle_id → license_plate (из GTFS) → plate (из vehicles.json)
const lookupVehicle = (vehicleId, label, licensePlate) => {
  for (const id of [label, vehicleId].filter(Boolean)) {
    const key = String(id).trim()
    if (vehiclesDb[key]) return vehiclesDb[key]
    const stripped = key.replace(/^0+/, '')
    if (stripped && vehiclesDb[stripped]) return vehiclesDb[stripped]
  }
  if (licensePlate) {
    const norm = normPlate(licensePlate)
    if (norm) return getPlateIndex()[norm] || null
  }
  return null
}

const COLORS = { bus: '#27ae60', trolley: '#3498db', tram: '#e74c3c' }

const resolveTransportType = (v, fallback) => {
  const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate)
  if (info?.type) return info.type
  if (v.license_plate && normPlate(v.license_plate).length > 0) return 'bus'
  return fallback || 'bus'
}

const createVehicleIcon = (type, bearing = 0, selected = false, routeNum = '', dimmed = false) => {
  const color = COLORS[type] || COLORS.bus
  const size = selected ? 36 : 28
  const fs = routeNum.length > 3 ? 8 : routeNum.length > 2 ? 9 : 10
  return L.divIcon({
    html: `<div style="position:relative;width:${size}px;height:${size+8}px;opacity:${dimmed?0.22:1}">
      <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%) rotate(${bearing}deg);
        width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
        border-bottom:7px solid ${color};opacity:0.85"></div>
      <div style="position:absolute;top:3px;left:0;width:${size}px;height:${size}px;border-radius:50%;
        background:${color};border:${selected?3:1.5}px solid ${selected?'#fff':'rgba(0,0,0,0.4)'};
        display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:800;
        color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)${selected?`,0 0 14px ${color}90`:''};
        line-height:1;letter-spacing:-0.3px">${routeNum}</div></div>`,
    className: 'vehicle-marker-icon',
    iconSize: [size, size+8],
    iconAnchor: [size/2, size/2+4],
    popupAnchor: [0, -(size/2+8)],
  })
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: onMapClick })
  return null
}

function MapUpdater({ center }) {
  const map = useMap()
  useEffect(() => { if (center) map.setView(center, map.getZoom()) }, [center]) // eslint-disable-line
  return null
}

function VehiclePopup({ v, resolvedType }) {
  const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate)
  const plate = v.license_plate || info?.plate || ''
  return (
    <div className="vehicle-popup">
      <div className="vehicle-popup-id">{v.label || v.vehicle_id}</div>
      {v.route_short_name && <div className="vehicle-popup-route">Маршрут {v.route_short_name}</div>}
      <div className="vehicle-popup-speed">{v.speed} км/ч · ▲{Math.round(v.bearing)}°</div>
      {info?.model && <div className="vehicle-popup-model">{info.model}</div>}
      {plate && <div className="vehicle-popup-plate">{plate}</div>}
      <div className="vehicle-popup-type">{{ tram:'Трамвай', trolley:'Троллейбус', bus:'Автобус' }[resolvedType]||'Автобус'}</div>
    </div>
  )
}

function LiveMap({ routeId, routeName, transportType, stops, onClose, direction = 0 }) {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [filterRouteNum, setFilterRouteNum] = useState(null)
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
      .then(r => r.json()).then(d => setShapeLine(d.coordinates || [])).catch(() => {})
  }, [routeId, routeName, direction])

  useEffect(() => {
    fetchVehicles()
    if (autoRefresh) intervalRef.current = setInterval(fetchVehicles, 10000)
    const tickI = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(intervalRef.current); clearInterval(tickI) }
  }, [fetchVehicles, autoRefresh])

  const secAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null
  const displayVehicles = filterRouteNum
    ? vehicles.filter(v => (v.route_short_name || routeName || '') === filterRouteNum)
    : vehicles

  const routeLine = shapeLine.length > 0
    ? shapeLine
    : (stops && stops.length > 1 ? stops.map(s => [s.stop_lat, s.stop_lon]) : [])
  const routeColor = COLORS[transportType] || COLORS.bus

  const defaultCenter = [59.9343, 30.3351]
  const mapCenter = displayVehicles.length > 0
    ? [displayVehicles[0].lat, displayVehicles[0].lon]
    : stops?.length > 0
      ? [stops[Math.floor(stops.length / 2)].stop_lat, stops[Math.floor(stops.length / 2)].stop_lon]
      : defaultCenter

  return (
    <div className="livemap-container">
      <div className="livemap-header">
        <div className="livemap-header-left">
          {onClose && <button className="livemap-back" onClick={onClose}>‹ Назад</button>}
          <div>
            <div className="livemap-title">
              {filterRouteNum
                ? `Маршрут ${filterRouteNum} — фильтр`
                : routeName ? `Маршрут ${routeName} — Живая карта` : 'Все маршруты — Живая карта'}
            </div>
            <div className="livemap-subtitle">
              <span className="livemap-live-dot" />
              {displayVehicles.length} машин на линии
              {secAgo !== null && ` · обн. ${secAgo}с назад`}
              {filterRouteNum && (
                <button className="livemap-filter-reset" onClick={() => setFilterRouteNum(null)}>
                  × все маршруты
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          className={`livemap-refresh-btn ${autoRefresh ? 'active' : ''}`}
          onClick={() => setAutoRefresh(a => !a)}
        >{autoRefresh ? '🔄' : '⏸️'}</button>
      </div>

      {loading ? (
        <div className="livemap-loading"><div className="spinner" /><p>Загружаем позиции...</p></div>
      ) : error ? (
        <div className="livemap-error"><p>❌ {error}</p><button onClick={fetchVehicles}>Повторить</button></div>
      ) : (
        <MapContainer center={mapCenter} zoom={13} className="livemap-map" scrollWheelZoom touchZoom>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <MapUpdater center={mapCenter} />
          <MapClickHandler onMapClick={() => { if (filterRouteNum) setFilterRouteNum(null); else setSelectedVehicle(null) }} />

          {routeLine.length > 1 && (
            <Polyline positions={routeLine} color={routeColor} weight={3} opacity={0.65} />
          )}

          {stops && stops.map((stop, i) => (
            <Marker
              key={`stop-${stop.stop_id || i}`}
              position={[stop.stop_lat, stop.stop_lon]}
              icon={L.divIcon({
                html: `<div style="width:8px;height:8px;border-radius:50%;background:rgba(91,155,247,0.7);border:1.5px solid rgba(91,155,247,0.4)"></div>`,
                className: 'stop-dot-icon', iconSize: [8,8], iconAnchor: [4,4],
              })}
            >
              <Popup><div style={{textAlign:'center',fontSize:12,color:'#fff'}}><strong>{stop.stop_name}</strong><div style={{color:'#aaa',marginTop:2}}>Остановка {i+1}</div></div></Popup>
            </Marker>
          ))}

          {vehicles.map(v => {
            const type = resolveTransportType(v, transportType)
            const vId = v.entity_id || v.vehicle_id
            const routeNum = v.route_short_name || routeName || ''
            const dimmed = !!filterRouteNum && routeNum !== filterRouteNum
            return (
              <Marker
                key={vId}
                position={[v.lat, v.lon]}
                icon={createVehicleIcon(type, v.bearing, selectedVehicle === vId, routeNum, dimmed)}
                eventHandlers={{ click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  setSelectedVehicle(vId === selectedVehicle ? null : vId)
                  if (!routeId && routeNum && routeNum !== filterRouteNum) setFilterRouteNum(routeNum)
                  else if (routeNum === filterRouteNum) setFilterRouteNum(null)
                }}}
              >
                <Popup><VehiclePopup v={v} resolvedType={type} /></Popup>
              </Marker>
            )
          })}
        </MapContainer>
      )}

      {vehicles.length > 0 && (
        <div className="livemap-vehicles-list">
          <div className="livemap-list-header">
            Машины на линии ({displayVehicles.length}{filterRouteNum ? ` · маршрут ${filterRouteNum}` : ''})
          </div>
          {displayVehicles.slice(0, 20).map(v => {
            const info = lookupVehicle(v.vehicle_id, v.label, v.license_plate)
            const type = resolveTransportType(v, transportType)
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
                {info?.model && <span className="livemap-vehicle-model">{info.model}</span>}
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
