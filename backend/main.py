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
    """Создаём индексы при старте если их нет"""
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
