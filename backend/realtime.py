# =============================================================================
# REALTIME - GTFS-RT polling для СПб транспорта
# =============================================================================
# Получает реальные позиции транспорта и прогнозы прибытия
# с портала transport.orgp.spb.ru
# =============================================================================

import httpx
import time
import asyncio
from typing import Dict, List, Optional
from google.transit import gtfs_realtime_pb2

# =============================================================================
# URL эндпоинтов ORGP SPB (подтверждены, без авторизации)
# =============================================================================

BASE_URL = "https://transport.orgp.spb.ru/Portal/transport/internalapi/gtfs/realtime"
VEHICLE_URL = f"{BASE_URL}/vehicle"
FORECAST_URL = f"{BASE_URL}/stopforecast"
VEHICLETRIPS_URL = f"{BASE_URL}/vehicletrips"

# =============================================================================
# In-memory хранилище
# =============================================================================

vehicle_positions: Dict[str, dict] = {}
last_update = {"vehicle": 0, "forecast": 0}

# =============================================================================
# Получение позиций транспорта
# =============================================================================

async def fetch_vehicle_positions(route_ids: str = None, transports: str = None, bbox: str = None):
    """
    Загрузить позиции транспорта с ORGP API.
    
    Args:
        route_ids: ID маршрутов через запятую (из routes.txt route_id)
        transports: Типы транспорта: bus,trolley,tram,ship
        bbox: Bounding box: lon_min,lat_min,lon_max,lat_max
    """
    global vehicle_positions, last_update
    try:
        params = {}
        if route_ids:
            params["routeIDs"] = route_ids
        if transports:
            params["transports"] = transports
        if bbox:
            params["bbox"] = bbox

        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.get(VEHICLE_URL, params=params)
            resp.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)

        positions = {}
        for entity in feed.entity:
            v = entity.vehicle
            positions[entity.id] = {
                "entity_id": entity.id,
                "route_id": v.trip.route_id if v.trip.route_id else None,
                "trip_id": v.trip.trip_id if v.trip.trip_id else None,
                "lat": round(v.position.latitude, 6),
                "lon": round(v.position.longitude, 6),
                "bearing": v.position.bearing if v.position.bearing else 0,
                "speed": round(v.position.speed * 3.6, 1) if v.position.speed else 0,
                "vehicle_id": v.vehicle.id if v.vehicle.id else entity.id,
                "label": v.vehicle.label if v.vehicle.label else "",
                "license_plate": v.vehicle.license_plate if v.vehicle.license_plate else "",
                "timestamp": v.timestamp if v.timestamp else feed.header.timestamp,
            }

        vehicle_positions = positions
        last_update["vehicle"] = time.time()
        print(f"🛰️ Получено {len(positions)} транспортных средств")
        return positions

    except Exception as e:
        print(f"❌ Ошибка получения позиций: {e}")
        return vehicle_positions  # возвращаем старые данные


def get_vehicles_for_route(route_id: str) -> List[dict]:
    """Получить позиции ТС для конкретного маршрута"""
    return [v for v in vehicle_positions.values() if str(v.get("route_id")) == str(route_id)]


def get_all_vehicles() -> List[dict]:
    """Получить все позиции ТС"""
    return list(vehicle_positions.values())

# =============================================================================
# Прогноз прибытия на остановку
# =============================================================================

async def fetch_stop_forecast(stop_id: str) -> List[dict]:
    """
    Получить прогноз прибытия на остановку.
    
    Args:
        stop_id: ID остановки из stops.txt (stop_id)
    
    Returns:
        List[dict]: Список прогнозов прибытия
    """
    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.get(FORECAST_URL, params={"stopID": stop_id})
            resp.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)

        forecasts = []
        for entity in feed.entity:
            tu = entity.trip_update
            route_id = tu.trip.route_id if tu.trip.route_id else ""
            trip_id = tu.trip.trip_id if tu.trip.trip_id else ""
            vehicle_id = tu.vehicle.id if tu.vehicle and tu.vehicle.id else ""

            for stu in tu.stop_time_update:
                arrival_time = None
                delay = 0

                if stu.HasField('arrival'):
                    arrival_time = stu.arrival.time if stu.arrival.time else None
                    delay = stu.arrival.delay if stu.arrival.delay else 0

                if arrival_time:
                    forecasts.append({
                        "route_id": route_id,
                        "trip_id": trip_id,
                        "vehicle_id": vehicle_id,
                        "stop_id": stu.stop_id if stu.stop_id else stop_id,
                        "arrival_time": arrival_time,
                        "delay_seconds": delay,
                        "is_realtime": True,
                    })

        last_update["forecast"] = time.time()
        print(f"📡 Прогноз для остановки {stop_id}: {len(forecasts)} прибытий")
        return forecasts

    except Exception as e:
        print(f"❌ Ошибка прогноза для остановки {stop_id}: {e}")
        return []

# =============================================================================
# Маршрутный лист конкретного ТС
# =============================================================================

async def fetch_vehicle_trips(vehicle_ids: str) -> List[dict]:
    """
    Получить маршрутный лист конкретных ТС.
    
    Args:
        vehicle_ids: ID через запятую (например "1103,2733")
    
    Returns:
        List[dict]: Маршрутные листы
    """
    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.get(VEHICLETRIPS_URL, params={"vehicleIDs": vehicle_ids})
            resp.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)

        trips = []
        for entity in feed.entity:
            tu = entity.trip_update
            stops = []
            for s in tu.stop_time_update:
                arrival = s.arrival.time if s.HasField('arrival') and s.arrival.time else None
                if arrival:
                    stops.append({
                        "stop_id": s.stop_id,
                        "arrival_time": arrival,
                        "delay_seconds": s.arrival.delay if s.arrival.delay else 0,
                    })
            trips.append({
                "vehicle_id": tu.vehicle.id if tu.vehicle and tu.vehicle.id else "",
                "route_id": tu.trip.route_id if tu.trip.route_id else "",
                "trip_id": tu.trip.trip_id if tu.trip.trip_id else "",
                "stops": stops,
            })

        return trips

    except Exception as e:
        print(f"❌ Ошибка vehicletrips: {e}")
        return []

# =============================================================================
# Фоновый polling
# =============================================================================

async def start_polling(interval_seconds: int = 15):
    """Запуск фонового polling позиций (вызывается из main.py)"""
    print(f"🔄 Запуск GTFS-RT polling каждые {interval_seconds} сек")
    while True:
        await fetch_vehicle_positions()
        await asyncio.sleep(interval_seconds)
