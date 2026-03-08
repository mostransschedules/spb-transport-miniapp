// =============================================================================
// LIVEMAP - Живая карта транспорта (GTFS-RT)
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './LiveMap.css'
import vehiclesDb from '../vehicles.json'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// =============================================================================
// Умная идентификация типа транспортного средства
//
// Приоритет:
//   1. vehicles.json по vehicle_id / label
//   2. Гос.номер есть → автобус (у трамваев/троллейбусов нет гос.номеров)
//   3. route_id из GTFS → тип по пропсу routeTransportType
//   4. Фоллбэк — тип из пропса transportType
// =============================================================================
const lookupVehicle = (vehicleId, label) => {
  const candidates = [label, vehicleId].filter(Boolean)
  for (const id of candidates) {
    const key = String(id).trim()
    if (vehiclesDb[key]) return vehiclesDb[key]
    const stripped = key.replace(/^0+/, '')
    if (stripped && vehiclesDb[stripped]) return vehiclesDb[stripped]
  }
  return null
}

const resolveTransportType = (v, fallbackType) => {
  // 1. vehicles.json — самый точный источник
  const info = lookupVehicle(v.vehicle_id, v.label)
  if (info?.type) return info.type

  // 2. Если есть гос.номер — это автобус (у трамваев/троллейбусов их нет)
  if (v.license_plate && v.license_plate.trim().length > 0) return 'bus'

  // 3. Фоллбэк на тип маршрута из пропсов
  return fallbackType || 'bus'
}

// =============================================================================
// Иконка ТС с номером маршрута
// =============================================================================
const createVehicleIcon = (transportType, bearing = 0, isSelected = false, routeNumber = '') => {
  const colors = {
    bus: '#27ae60',
    trolley: '#3498db',
    tram: '#e74c3c',
  }
  const color = colors[transportType] || colors.bus
  const size = isSelected ? 36 : 28
  const borderColor = isSelected ? '#fff' : 'rgba(0,0,0,0.4)'
  const borderWidth = isSelected ? 3 : 1.5
  const fontSize = routeNumber.length > 3 ? 8 : routeNumber.length > 2 ? 9 : 10

  return L.divIcon({
    html: `
      <div style="position:relative;width:${size}px;height:${size + 8}px;">
        <!-- Направление (стрелка) -->
        <div style="
          position:absolute;top:-5px;left:50%;
          transform:translateX(-50%) rotate(${bearing}deg);
          width:0;height:0;
          border-left:4px solid transparent;
          border-right:4px solid transparent;
          border-bottom:7px solid ${color};
          opacity:0.85;
        "></div>
        <!-- Кружок с номером маршрута -->
        <div style="
          position:absolute;top:3px;left:0;
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};
          border:${borderWidth}px solid ${borderColor};
          display:flex;align-items:center;justify-content:center;
          font-size:${fontSize}px;font-weight:800;color:#fff;
          box-shadow:0 2px 6px rgba(0,0,0,0.35)
          ${isSelected ? `,0 0 14px ${color}90` : ''};
          line-height:1;
          letter-spacing:-0.3px;
        ">${routeNumber || ''}</div>
      </div>
    `,
    className: 'vehicle-marker-icon',
    iconSize: [size, size + 8],
    iconAnchor: [size / 2, size / 2 + 4],
    popupAnchor: [0, -(size / 2 + 8)],
  })
}

// =============================================================================
// Компонент обновления вида карты
// =============================================================================
function MapUpdater({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.setView(center, map.getZoom())
  }, [center]) // eslint-disable-line
  return null
}

// =============================================================================
// Попап ТС
// =============================================================================
function VehiclePopup({ v, resolvedType }) {
  const info = lookupVehicle(v.vehicle_id, v.label)
  const typeLabel = resolvedType === 'tram' ? 'Трамвай' : resolvedType === 'trolley' ? 'Троллейбус' : 'Автобус'

  return (
    <div className="vehicle-popup">
      <div className="vehicle-popup-id">{v.label || v.vehicle_id}</div>
      {v.route_short_name && (
        <div className="vehicle-popup-route">Маршрут {v.route_short_name}</div>
      )}
      <div className="vehicle-popup-speed">{v.speed} км/ч · ▲{Math.round(v.bearing)}°</div>
      {info?.model && (
        <div className="vehicle-popup-model">{info.model}</div>
      )}
      {(v.license_plate || info?.plate) && (
        <div className="vehicle-popup-plate">{v.license_plate || info?.plate}</div>
      )}
      <div className="vehicle-popup-type">{typeLabel}</div>
    </div>
  )
}

// =============================================================================
// Основной компонент
// =============================================================================
function LiveMap({ routeId, routeName, transportType, stops, onClose }) {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef(null)

  const defaultCenter = [59.9343, 30.3351]

  const fetchVehicles = useCallback(async () => {
    try {
      const url = routeId
        ? `${API_URL}/api/realtime/vehicles?route_id=${routeId}`
        : `${API_URL}/api/realtime/vehicles`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setVehicles(data.vehicles || [])
      setLastUpdate(new Date())
      setError(null)
      setLoading(false)
    } catch (e) {
      console.error('LiveMap fetch error:', e)
      setError('Не удалось загрузить позиции транспорта')
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    fetchVehicles()
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchVehicles, 10000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchVehicles, autoRefresh])

  const mapCenter = vehicles.length > 0
    ? [vehicles[0].lat, vehicles[0].lon]
    : stops && stops.length > 0
      ? [stops[Math.floor(stops.length / 2)]?.stop_lat || stops[0].stop_lat,
         stops[Math.floor(stops.length / 2)]?.stop_lon || stops[0].stop_lon]
      : defaultCenter

  const secAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null

  return (
    <div className="livemap-container">
      {/* Header */}
      <div className="livemap-header">
        <div className="livemap-header-left">
          {onClose && (
            <button className="livemap-back" onClick={onClose}>‹ Назад</button>
          )}
          <div>
            <div className="livemap-title">
              {routeName ? `Маршрут ${routeName}` : 'Все маршруты'} — Живая карта
            </div>
            <div className="livemap-subtitle">
              <span className="livemap-live-dot" />
              {vehicles.length} машин на линии
              {secAgo !== null && ` · обн. ${secAgo}с назад`}
            </div>
          </div>
        </div>
        <button
          className={`livemap-refresh-btn ${autoRefresh ? 'active' : ''}`}
          onClick={() => setAutoRefresh(!autoRefresh)}
          title={autoRefresh ? 'Авто-обновление ВКЛ' : 'Авто-обновление ВЫКЛ'}
        >
          {autoRefresh ? '🔄' : '⏸️'}
        </button>
      </div>

      {/* Map */}
      {loading ? (
        <div className="livemap-loading">
          <div className="spinner" />
          <p>Загружаем позиции...</p>
        </div>
      ) : error ? (
        <div className="livemap-error">
          <p>❌ {error}</p>
          <button onClick={fetchVehicles}>Повторить</button>
        </div>
      ) : (
        <MapContainer
          center={mapCenter}
          zoom={13}
          className="livemap-map"
          scrollWheelZoom={true}
          touchZoom={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <MapUpdater center={mapCenter} />

          {/* Stop markers */}
          {stops && stops.map((stop, i) => (
            <Marker
              key={`stop-${stop.stop_id || i}`}
              position={[stop.stop_lat, stop.stop_lon]}
              icon={L.divIcon({
                html: `<div style="width:8px;height:8px;border-radius:50%;background:rgba(91,155,247,0.7);border:1.5px solid rgba(91,155,247,0.4);"></div>`,
                className: 'stop-dot-icon',
                iconSize: [8, 8],
                iconAnchor: [4, 4],
              })}
            >
              <Popup>
                <div style={{ textAlign: 'center', fontSize: 12, color: '#fff' }}>
                  <strong>{stop.stop_name}</strong>
                  <div style={{ color: '#aaa', marginTop: 2 }}>Остановка {i + 1}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Vehicle markers */}
          {vehicles.map(v => {
            const resolvedType = resolveTransportType(v, transportType)
            const isSelected = selectedVehicle === (v.entity_id || v.vehicle_id)
            // Номер маршрута — из данных ТС или из пропса
            const routeNum = v.route_short_name || routeName || ''

            return (
              <Marker
                key={v.entity_id || v.vehicle_id}
                position={[v.lat, v.lon]}
                icon={createVehicleIcon(resolvedType, v.bearing, isSelected, routeNum)}
                eventHandlers={{
                  click: () => setSelectedVehicle(
                    isSelected ? null : (v.entity_id || v.vehicle_id)
                  ),
                }}
              >
                <Popup>
                  <VehiclePopup v={v} resolvedType={resolvedType} />
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      )}

      {/* Vehicle list */}
      {vehicles.length > 0 && (
        <div className="livemap-vehicles-list">
          <div className="livemap-list-header">Машины на линии ({vehicles.length})</div>
          {vehicles.slice(0, 20).map(v => {
            const info = lookupVehicle(v.vehicle_id, v.label)
            const resolvedType = resolveTransportType(v, transportType)
            const colors = { bus: '#27ae60', trolley: '#3498db', tram: '#e74c3c' }
            const dotColor = colors[resolvedType] || colors.bus
            return (
              <div
                key={v.entity_id || v.vehicle_id}
                className={`livemap-vehicle-item ${selectedVehicle === (v.entity_id || v.vehicle_id) ? 'selected' : ''}`}
                onClick={() => setSelectedVehicle(
                  selectedVehicle === (v.entity_id || v.vehicle_id) ? null : (v.entity_id || v.vehicle_id)
                )}
              >
                <span className="livemap-vehicle-dot" style={{ background: dotColor }} />
                <span className="livemap-vehicle-id">{v.label || v.vehicle_id}</span>
                {(v.route_short_name || routeName) && (
                  <span className="livemap-vehicle-route" style={{ background: dotColor }}>
                    {v.route_short_name || routeName}
                  </span>
                )}
                {info?.model && (
                  <span className="livemap-vehicle-model">{info.model}</span>
                )}
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
