# =============================================================================
# BACKEND - FastAPI Server
# =============================================================================
# Этот файл создаёт API сервер который отвечает на запросы от фронтенда
# Работает с DuckDB и возвращает данные в формате JSON
# =============================================================================

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import duckdb
import os
from datetime import datetime
import time

# Импортируем функции для работы с БД
from database import (
    get_routes_list,
    get_route_schedule,
    get_stops_for_route,
    get_intervals_for_stop,
    get_trip_durations,
    search_stops,
    get_nearby_stops,
    get_transfers_at_stop
)

# Импортируем GTFS-RT модуль
import realtime

# =============================================================================
# Создание приложения FastAPI
# =============================================================================

app = FastAPI(
    title="GTFS SPB API",
    description="API для расписания общественного транспорта Санкт-Петербурга",
    version="1.0.0"
)

@app.on_event("startup")
async def startup_event():
    """Создаём индексы и запускаем GTFS-RT polling при старте"""
    # Индексы
    try:
        import duckdb
        from database import DB_PATH
        con = duckdb.connect(DB_PATH, read_only=False)
        con.execute("CREATE INDEX IF NOT EXISTS idx_stops_name ON stops(stop_name)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_trips_direction ON trips(direction_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id)")
        con.close()
        print("✅ Индексы созданы")
    except Exception as e:
        print(f"⚠️ Не удалось создать индексы: {e}")
    
    # Запуск GTFS-RT polling в фоне
    import asyncio
    try:
        asyncio.create_task(realtime.start_polling(interval_seconds=15))
        print("✅ GTFS-RT polling запущен")
    except Exception as e:
        print(f"⚠️ GTFS-RT polling не запущен: {e}")

# =============================================================================
# CORS (Cross-Origin Resource Sharing)
# =============================================================================
# Позволяет фронтенду (Vercel) делать запросы к бэкенду (Render)
# Без этого браузер заблокирует запросы из-за разных доменов

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Разрешаем запросы с любых доменов
    allow_credentials=True,
    allow_methods=["*"],  # Разрешаем все HTTP методы (GET, POST, etc)
    allow_headers=["*"],  # Разрешаем все заголовки
)

# =============================================================================
# ENDPOINTS (API точки доступа)
# =============================================================================

@app.get("/")
async def root():
    """
    Главная страница API - просто проверка что сервер работает
    """
    return {
        "message": "GTFS SPB API is running",
        "status": "ok",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health_check():
    """
    Эндпоинт для проверки здоровья сервера
    Используется для мониторинга и "пробуждения" сервера
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/routes")
async def get_routes():
    """
    Получить список всех маршрутов
    
    Возвращает:
        List[dict]: Список маршрутов с полями:
            - route_short_name: Номер маршрута (например, "1")
            - route_long_name: Полное название (например, "Метро Китай-город - ...")
            - route_id: ID маршрута в базе
    
    Пример ответа:
    [
        {
            "route_short_name": "1",
            "route_long_name": "Метро «Китай-город» - Чистопрудный бульвар",
            "route_id": "4126"
        },
        ...
    ]
    """
    try:
        routes = get_routes_list()
        return {"routes": routes, "count": len(routes)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения маршрутов: {str(e)}")

@app.get("/api/route/{route_short_name}/stops")
async def get_stops(
    route_short_name: str,
    direction: int = Query(0, description="Направление: 0 - прямое, 1 - обратное"),
    route_id: str = Query(None, description="ID маршрута для точного выбора")
):
    """
    Получить список остановок для маршрута
    """
    try:
        stops = get_stops_for_route(route_short_name, direction, route_id)
        
        if not stops:
            raise HTTPException(
                status_code=404, 
                detail=f"Маршрут {route_short_name} не найден или нет остановок"
            )
        
        return {
            "route": route_short_name,
            "direction": direction,
            "stops": stops,
            "count": len(stops)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения остановок: {str(e)}")

@app.get("/api/route/{route_short_name}/shape")
async def get_route_shape(
    route_short_name: str,
    direction: int = Query(0),
    route_id: str = Query(None)
):
    """Линия маршрута: сначала из таблицы shapes, если нет - из координат остановок"""
    try:
        from database import get_connection
        con = get_connection()

        # Resolve route_id
        if not route_id:
            r = con.execute("SELECT route_id FROM routes WHERE route_short_name = ?", [route_short_name]).fetchone()
            if not r:
                con.close()
                return {"coordinates": []}
            route_id = str(r[0])

        # Попробуем получить shape_id из trips
        shape_row = con.execute("""
            SELECT shape_id FROM trips
            WHERE CAST(route_id AS VARCHAR) = ? AND CAST(direction_id AS VARCHAR) = ?
              AND shape_id IS NOT NULL AND shape_id != ''
            LIMIT 1
        """, [route_id, str(direction)]).fetchone()

        if shape_row and shape_row[0]:
            # Есть shapes — берём из таблицы
            try:
                df = con.execute("""
                    SELECT shape_pt_lat, shape_pt_lon
                    FROM shapes
                    WHERE shape_id = ?
                    ORDER BY shape_pt_sequence
                """, [shape_row[0]]).df()
                con.close()
                if not df.empty:
                    coords = [[row["shape_pt_lat"], row["shape_pt_lon"]] for _, row in df.iterrows()]
                    return {"coordinates": coords, "source": "shapes"}
            except Exception:
                pass  # Таблицы shapes нет — идём дальше

        # Fallback: линия через остановки по порядку
        df = con.execute("""
            WITH route_trips AS (
                SELECT DISTINCT trip_id FROM trips
                WHERE CAST(route_id AS VARCHAR) = ? AND CAST(direction_id AS VARCHAR) = ?
            ),
            stop_seqs AS (
                SELECT st.stop_id, MIN(st.stop_sequence) as seq
                FROM stop_times st
                WHERE st.trip_id IN (SELECT trip_id FROM route_trips)
                GROUP BY st.stop_id
            )
            SELECT s.stop_lat, s.stop_lon
            FROM stop_seqs ss
            JOIN stops s ON CAST(ss.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
            ORDER BY ss.seq
        """, [route_id, str(direction)]).df()
        con.close()

        if df.empty:
            return {"coordinates": [], "source": "none"}

        coords = [[row["stop_lat"], row["stop_lon"]] for _, row in df.iterrows()]
        return {"coordinates": coords, "source": "stops"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/route/{route_short_name}/schedule")
async def get_schedule(
    route_short_name: str,
    stop_name: str = Query(..., description="Название остановки"),
    direction: int = Query(0, description="Направление: 0 - прямое, 1 - обратное"),
    day_type: str = Query("weekday", description="Тип дня: weekday или weekend"),
    route_id: str = Query(None, description="ID маршрута для точного выбора")
):
    """
    Получить расписание для конкретной остановки
    """
    try:
        schedule = get_route_schedule(route_short_name, stop_name, direction, day_type, route_id)
        
        if not schedule:
            raise HTTPException(
                status_code=404,
                detail=f"Расписание не найдено для остановки {stop_name}"
            )
        
        return {
            "route": route_short_name,
            "stop": stop_name,
            "direction": direction,
            "day_type": day_type,
            "schedule": schedule,
            "count": len(schedule)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения расписания: {str(e)}")

@app.get("/api/route/{route_short_name}/intervals")
async def get_intervals(
    route_short_name: str,
    stop_name: str = Query(..., description="Название остановки"),
    direction: int = Query(0, description="Направление"),
    day_type: str = Query("weekday", description="Тип дня"),
    route_id: str = Query(None, description="ID маршрута для точного выбора")
):
    try:
        intervals = get_intervals_for_stop(route_short_name, stop_name, direction, day_type, route_id)
        
        if not intervals:
            raise HTTPException(
                status_code=404,
                detail=f"Интервалы не найдены для остановки {stop_name}"
            )
        
        return {
            "route": route_short_name,
            "stop": stop_name,
            "direction": direction,
            "day_type": day_type,
            "intervals": intervals
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения интервалов: {str(e)}")

@app.get("/api/route/{route_short_name}/durations")
async def get_durations(
    route_short_name: str,
    direction: int = Query(0, description="Направление"),
    day_type: str = Query("weekday", description="Тип дня"),
    route_id: str = Query(None, description="ID маршрута для точного выбора")
):
    try:
        durations = get_trip_durations(route_short_name, direction, day_type, route_id)
        
        if not durations:
            raise HTTPException(
                status_code=404,
                detail=f"Данные о длительности рейсов не найдены"
            )
        
        return {
            "route": route_short_name,
            "direction": direction,
            "day_type": day_type,
            "durations": durations
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения времени рейсов: {str(e)}")

@app.get("/api/search/stops")
async def search_stops_endpoint(
    q: str = Query(..., description="Поисковый запрос"),
    limit: int = Query(20, description="Максимум результатов")
):
    """
    Поиск остановок по названию с маршрутами через них.
    """
    try:
        if len(q.strip()) < 2:
            return {"stops": [], "query": q}
        results = search_stops(q.strip(), limit)
        return {"stops": results, "query": q}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка поиска: {str(e)}")


@app.get("/api/stops/nearby")
async def get_stops_nearby(
    lat: float = Query(..., description="Широта пользователя"),
    lon: float = Query(..., description="Долгота пользователя"),
    radius: int = Query(500, description="Радиус поиска в метрах")
):
    """
    Найти ближайшие остановки в радиусе от координат пользователя.
    Возвращает остановки с маршрутами, отсортированные по расстоянию.
    """
    try:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(status_code=400, detail="Некорректные координаты")
        radius = min(radius, 2000)  # максимум 2 км
        results = get_nearby_stops(lat, lon, radius)
        return {"stops": results, "lat": lat, "lon": lon, "radius": radius}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка геопоиска: {str(e)}")


@app.get("/api/stop/transfers")
async def get_stop_transfers(
    stop_name: str = Query(..., description="Название остановки"),
    exclude_route_id: str = Query(None, description="ID текущего маршрута (исключить)"),
    day_type: str = Query("weekday", description="Тип дня: weekday или weekend")
):
    """
    Получить все маршруты, проходящие через остановку (пересадки).
    Исключает текущий маршрут. Возвращает ближайшие рейсы для каждого.
    """
    try:
        transfers = get_transfers_at_stop(stop_name, exclude_route_id, day_type)
        return {
            "stop_name": stop_name,
            "transfers": transfers,
            "count": len(transfers)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения пересадок: {str(e)}")


# =============================================================================
# GTFS-RT ENDPOINTS (Реальное время)
# =============================================================================

@app.get("/api/realtime/vehicles")
async def rt_vehicles(
    route_id: str = Query(None, description="ID маршрута для фильтрации"),
):
    """Позиции транспорта (из кэша polling, обновляется каждые 15 сек)"""
    if route_id:
        vehicles = realtime.get_vehicles_for_route(route_id)
    else:
        vehicles = realtime.get_all_vehicles()

    # Обогащаем route_short_name и transport_type из БД по route_id
    try:
        from database import get_connection
        con = get_connection()
        route_ids = list({v["route_id"] for v in vehicles if v.get("route_id")})
        if route_ids:
            placeholders = ",".join(["?" for _ in route_ids])
            rows = con.execute(
                f"SELECT CAST(route_id AS VARCHAR) as rid, route_short_name, transport_type "
                f"FROM routes WHERE CAST(route_id AS VARCHAR) IN ({placeholders})",
                route_ids
            ).fetchall()
            con.close()
            rmap = {r[0]: {"route_short_name": str(r[1]), "transport_type": str(r[2] or "bus")} for r in rows}
            for v in vehicles:
                rid = str(v.get("route_id", ""))
                if rid in rmap:
                    v["route_short_name"] = rmap[rid]["route_short_name"]
                    if not v.get("transport_type"):
                        v["transport_type"] = rmap[rid]["transport_type"]
        else:
            con.close()
    except Exception as e:
        print(f"⚠️ vehicle enrich error: {e}")

    return {
        "vehicles": vehicles,
        "count": len(vehicles),
        "last_update": realtime.last_update["vehicle"],
    }

@app.get("/api/realtime/vehicles/live")
async def rt_vehicles_live(
    route_id: str = Query(None, description="ID маршрута"),
    transports: str = Query(None, description="bus,trolley,tram"),
    bbox: str = Query(None, description="lon_min,lat_min,lon_max,lat_max"),
):
    """Позиции транспорта (свежий запрос к ORGP, не из кэша)"""
    positions = await realtime.fetch_vehicle_positions(
        route_ids=route_id, transports=transports, bbox=bbox
    )
    return {
        "vehicles": list(positions.values()) if isinstance(positions, dict) else positions,
        "count": len(positions),
        "timestamp": time.time(),
    }

@app.get("/api/realtime/forecast/{stop_id}")
async def rt_forecast(stop_id: str):
    """Прогноз прибытия на остановку (запрос к ORGP stopforecast)"""
    try:
        forecasts = await realtime.fetch_stop_forecast(stop_id)
        
        # Обогащаем данными из routes (имя маршрута, тип)
        from database import get_connection
        route_names = {}
        if forecasts:
            con = get_connection()
            try:
                route_ids = list(set(f["route_id"] for f in forecasts if f["route_id"]))
                if route_ids:
                    placeholders = ",".join(["?" for _ in route_ids])
                    rows = con.execute(f"""
                        SELECT CAST(route_id AS VARCHAR) as route_id, 
                               route_short_name, route_type, transport_type
                        FROM routes 
                        WHERE CAST(route_id AS VARCHAR) IN ({placeholders})
                    """, route_ids).fetchall()
                    route_names = {
                        r[0]: {"name": r[1], "route_type": r[2], "transport_type": r[3]}
                        for r in rows
                    }
            finally:
                con.close()
        
        # Обогащаем route_short_name и transport_type
        for f in forecasts:
            info = route_names.get(str(f["route_id"]), {})
            f["route_short_name"] = info.get("name", "")
            f["route_type"] = info.get("route_type", 3)
            f["transport_type"] = info.get("transport_type", "bus")

        # Обогащаем direction_id из БД по trip_id
        try:
            from database import get_connection
            con2 = get_connection()
            trip_ids = list({f["trip_id"] for f in forecasts if f.get("trip_id")})
            if trip_ids:
                placeholders2 = ",".join(["?" for _ in trip_ids])
                dir_rows = con2.execute(
                    f"SELECT CAST(trip_id AS VARCHAR), direction_id FROM trips "
                    f"WHERE CAST(trip_id AS VARCHAR) IN ({placeholders2})",
                    trip_ids
                ).fetchall()
                con2.close()
                dir_map = {r[0]: int(r[1]) for r in dir_rows if r[1] is not None}
                for f in forecasts:
                    tid = str(f.get("trip_id", ""))
                    if tid in dir_map:
                        f["direction_id"] = dir_map[tid]
            else:
                con2.close()
        except Exception as e2:
            print(f"⚠️ direction enrich error: {e2}")

        return {
            "stop_id": stop_id,
            "forecasts": forecasts,
            "count": len(forecasts),
            "timestamp": time.time(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка прогноза: {str(e)}")

@app.get("/api/realtime/vehicletrips")
async def rt_vehicletrips(
    vehicle_ids: str = Query(..., description="ID ТС через запятую"),
):
    """Маршрутный лист конкретных ТС"""
    try:
        trips = await realtime.fetch_vehicle_trips(vehicle_ids)
        return {"trips": trips, "count": len(trips)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка: {str(e)}")

@app.get("/api/realtime/status")
async def rt_status():
    """Статус GTFS-RT фидов"""
    return {
        "vehicle_count": len(realtime.vehicle_positions),
        "last_vehicle_update": realtime.last_update["vehicle"],
        "last_forecast_update": realtime.last_update["forecast"],
        "polling_active": True,
    }


# =============================================================================
# Запуск сервера (только для локальной разработки)
# =============================================================================
# На Render используется команда: uvicorn main:app --host 0.0.0.0 --port $PORT

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True  # Автоперезагрузка при изменении кода
    )
