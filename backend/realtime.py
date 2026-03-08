# =============================================================================
# REALTIME - GTFS-RT polling для СПб транспорта
# =============================================================================

import httpx
import time
import asyncio
import traceback
from typing import Dict, List
from google.transit import gtfs_realtime_pb2

BASE_URL = "https://transport.orgp.spb.ru/Portal/transport/internalapi/gtfs/realtime"
VEHICLE_URL = f"{BASE_URL}/vehicle"
FORECAST_URL = f"{BASE_URL}/stopforecast"
VEHICLETRIPS_URL = f"{BASE_URL}/vehicletrips"

vehicle_positions: Dict[str, dict] = {}
last_update = {"vehicle": 0, "forecast": 0}


def _client():
    return httpx.AsyncClient(timeout=20, verify=False)


async def fetch_vehicle_positions(route_ids: str = None, transports: str = None, bbox: str = None):
    global vehicle_positions, last_update
    try:
        params = {}
        if route_ids:
            params["routeIDs"] = route_ids
        if transports:
            params["transports"] = transports
        if bbox:
            params["bbox"] = bbox

        async with _client() as client:
            resp = await client.get(VEHICLE_URL, params=params)
            resp.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)

        positions = {}
        for entity in feed.entity:
            v = entity.vehicle
            positions[entity.id] = {
                "entity_id": entity.id,
                "route_id": str(v.trip.route_id) if v.trip.route_id else None,
                "trip_id": str(v.trip.trip_id) if v.trip.trip_id else None,
                "lat": round(v.position.latitude, 6),
                "lon": round(v.position.longitude, 6),
                "bearing": v.position.bearing if v.position.bearing else 0,
                "speed": round(v.position.speed * 3.6, 1) if v.position.speed else 0,
                "vehicle_id": str(v.vehicle.id) if v.vehicle.id else str(entity.id),
                "label": str(v.vehicle.label) if v.vehicle.label else "",
                "license_plate": str(v.vehicle.license_plate) if v.vehicle.license_plate else "",
                "timestamp": v.timestamp if v.timestamp else feed.header.timestamp,
            }

        vehicle_positions = positions
        last_update["vehicle"] = time.time()
        print(f"🛰️  Получено {len(positions)} ТС")
        return positions

    except Exception as e:
        print(f"❌ Ошибка получения позиций: {type(e).__name__}: {e}")
        traceback.print_exc()
        return vehicle_positions


def get_vehicles_for_route(route_id: str) -> List[dict]:
    return [v for v in vehicle_positions.values() if str(v.get("route_id")) == str(route_id)]


def get_all_vehicles() -> List[dict]:
    return list(vehicle_positions.values())


async def fetch_stop_forecast(stop_id: str) -> List[dict]:
    try:
        async with _client() as client:
            resp = await client.get(FORECAST_URL, params={"stopID": stop_id})
            resp.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)

        forecasts = []
        for entity in feed.entity:
            tu = entity.trip_update
            route_id = str(tu.trip.route_id) if tu.trip.route_id else ""
            trip_id = str(tu.trip.trip_id) if tu.trip.trip_id else ""
            vehicle_id = str(tu.vehicle.id) if tu.vehicle and tu.vehicle.id else ""

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
                        "stop_id": str(stu.stop_id) if stu.stop_id else str(stop_id),
                        "arrival_time": arrival_time,
                        "delay_seconds": delay,
                        "is_realtime": True,
                    })

        last_update["forecast"] = time.time()
        return forecasts

    except Exception as e:
        print(f"❌ Ошибка прогноза: {type(e).__name__}: {e}")
        return []


async def fetch_vehicle_trips(vehicle_ids: str) -> List[dict]:
    try:
        async with _client() as client:
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
                        "stop_id": str(s.stop_id),
                        "arrival_time": arrival,
                        "delay_seconds": s.arrival.delay if s.arrival.delay else 0,
                    })
            trips.append({
                "vehicle_id": str(tu.vehicle.id) if tu.vehicle and tu.vehicle.id else "",
                "route_id": str(tu.trip.route_id) if tu.trip.route_id else "",
                "trip_id": str(tu.trip.trip_id) if tu.trip.trip_id else "",
                "stops": stops,
            })
        return trips

    except Exception as e:
        print(f"❌ Ошибка vehicletrips: {type(e).__name__}: {e}")
        return []


async def start_polling(interval_seconds: int = 15):
    print(f"🔄 Запуск GTFS-RT polling каждые {interval_seconds} сек")
    await asyncio.sleep(2)
    while True:
        await fetch_vehicle_positions()
        await asyncio.sleep(interval_seconds)
