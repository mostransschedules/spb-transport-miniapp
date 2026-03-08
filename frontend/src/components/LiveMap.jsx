// =============================================================================
// LIVEMAP - Живая карта транспорта (GTFS-RT)
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './LiveMap.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Иконки для разных типов транспорта
const createVehicleIcon = (transportType, bearing = 0, isSelected = false) => {
  const colors = {
    bus: '#27ae60',
    trolley: '#3498db',
    tram: '#e74c3c',
  }
  const color = colors[transportType] || colors.bus
  const size = isSelected ? 32 : 24
  const borderColor = isSelected ? '#fff' : 'rgba(0,0,0,0.3)'
  const borderWidth = isSelected ? 3 : 1.5

  return L.divIcon({
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};border:${borderWidth}px solid ${borderColor};
          display:flex;align-items:center;justify-content:center;
          font-size:${isSelected ? 12 : 10}px;font-weight:700;color:#fff;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          ${isSelected ? `box-shadow:0 0 12px ${color}80;` : ''}
        "></div>
        <div style="
          position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(${bearing}deg);
          width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
          border-bottom:8px solid ${color};opacity:0.7;
        "></div>
      </div>
    `,
    className: 'vehicle-marker-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  })
}

// Компонент для обновления вида карты
function MapUpdater({ center, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.setView(center, zoom || map.getZoom())
  }, [center])
  return null
}

// Основной компонент
function LiveMap({ routeId, routeName, transportType, stops, onClose }) {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef(null)

  // Центр карты — СПб
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
      intervalRef.current = setInterval(fetchVehicles, 10000) // каждые 10 сек
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchVehicles, autoRefresh])

  // Центр карты по первому ТС или по остановкам
  const mapCenter = vehicles.length > 0
    ? [vehicles[0].lat, vehicles[0].lon]
    : stops && stops.length > 0
      ? [stops[0].stop_lat, stops[0].stop_lon]
      : defaultCenter

  const secAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null

  return (
    <div className="livemap-container">
      {/* Header */}
      <div className="livemap-header">
        <div className="livemap-header-left">
          <button className="livemap-back" onClick={onClose}>‹ Назад</button>
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
          zoom={12}
          className="livemap-map"
          scrollWheelZoom={true}
          touchZoom={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <MapUpdater center={mapCenter} />

          {/* Stop markers (if provided) */}
          {stops && stops.map((stop, i) => (
            <Marker
              key={`stop-${stop.stop_id}`}
              position={[stop.stop_lat, stop.stop_lon]}
              icon={L.divIcon({
                html: `<div style="width:8px;height:8px;border-radius:50%;background:rgba(91,155,247,0.6);border:1.5px solid rgba(91,155,247,0.3);"></div>`,
                className: 'stop-dot-icon',
                iconSize: [8, 8],
                iconAnchor: [4, 4],
              })}
            >
              <Popup>
                <div style={{textAlign:'center',fontSize:12}}>
                  <strong>{stop.stop_name}</strong>
                  <div style={{color:'#888',marginTop:2}}>Остановка {i + 1}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Vehicle markers */}
          {vehicles.map(v => (
            <Marker
              key={v.entity_id || v.vehicle_id}
              position={[v.lat, v.lon]}
              icon={createVehicleIcon(
                transportType || 'bus',
                v.bearing,
                selectedVehicle === v.entity_id
              )}
              eventHandlers={{
                click: () => setSelectedVehicle(
                  selectedVehicle === v.entity_id ? null : v.entity_id
                ),
              }}
            >
              <Popup>
                <div className="vehicle-popup">
                  <div className="vehicle-popup-id">{v.label || v.vehicle_id}</div>
                  <div className="vehicle-popup-speed">{v.speed} км/ч · ▲{Math.round(v.bearing)}°</div>
                  {v.license_plate && (
                    <div className="vehicle-popup-plate">{v.license_plate}</div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}

      {/* Vehicle list */}
      {vehicles.length > 0 && (
        <div className="livemap-vehicles-list">
          <div className="livemap-list-header">Машины на линии ({vehicles.length})</div>
          {vehicles.slice(0, 20).map(v => (
            <div
              key={v.entity_id || v.vehicle_id}
              className={`livemap-vehicle-item ${selectedVehicle === v.entity_id ? 'selected' : ''}`}
              onClick={() => setSelectedVehicle(
                selectedVehicle === v.entity_id ? null : v.entity_id
              )}
            >
              <span className="livemap-vehicle-id">{v.label || v.vehicle_id}</span>
              <span className="livemap-vehicle-speed">{v.speed} км/ч</span>
              <span className="livemap-vehicle-bearing">▲{Math.round(v.bearing)}°</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default LiveMap
