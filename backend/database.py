# =============================================================================
# DATABASE - Работа с DuckDB
# =============================================================================
# Этот файл содержит все функции для работы с базой данных DuckDB
# Все SQL запросы и обработка данных находятся здесь
# =============================================================================

import duckdb
import pandas as pd
import os
from typing import List, Dict, Optional

# =============================================================================
# ПУТЬ К БАЗЕ ДАННЫХ
# =============================================================================

# Определяем путь к базе данных
# В продакшене (Render) БД будет находиться в корневой папке проекта
DB_PATH = os.environ.get('DB_PATH', 'gtfs_spb.duckdb')

# Проверяем существует ли БД
if not os.path.exists(DB_PATH):
    print(f"⚠️ ВНИМАНИЕ: База данных не найдена по пути {DB_PATH}")
    print("Создайте БД с помощью init_db.py или загрузите gtfs_spb.duckdb")

# =============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =============================================================================

def get_connection():
    """
    Создаёт подключение к DuckDB
    
    Returns:
        duckdb.DuckDBPyConnection: Подключение к БД
    """
    try:
        con = duckdb.connect(DB_PATH, read_only=True)
        return con
    except Exception as e:
        print(f"❌ Ошибка подключения к БД: {e}")
        raise

def normalize_time(time_str: str) -> Optional[str]:
    """
    Нормализует время (24+ часов → 0-23)
    
    Например: "25:30:00" → "01:30:00"
    """
    if pd.isna(time_str):
        return None
    try:
        parts = str(time_str).split(':')
        hours = int(parts[0])
        if hours >= 24:
            hours = hours - 24
        return f"{hours:02d}:{parts[1]}:{parts[2]}"
    except:
        return None

def get_sort_key(time_str: str) -> int:
    """
    Создаёт ключ сортировки для времени (начало дня = 4:00)
    
    Используется для правильной сортировки расписания
    где транспортные сутки начинаются в 4:00
    """
    try:
        h, m = map(int, time_str.split(':')[:2])
        return (h * 60 + m + 24*60 - 4*60) % (24*60)
    except:
        return 9999

# =============================================================================
# ОСНОВНЫЕ ФУНКЦИИ API
# =============================================================================

def get_routes_list() -> List[Dict]:
    """
    Получить список всех маршрутов
    
    Returns:
        List[Dict]: Список маршрутов
    """
    con = get_connection()
    
    query = """
        SELECT DISTINCT
            route_short_name,
            route_long_name,
            route_id,
            route_type
        FROM routes
        ORDER BY 
            CASE 
                WHEN route_short_name ~ '^[0-9]+$' 
                THEN CAST(route_short_name AS INTEGER)
                ELSE 999999
            END,
            route_short_name
    """
    
    df = con.execute(query).df()
    con.close()
    
    records = df.to_dict('records')
    for r in records:
        r['route_id'] = str(r['route_id'])
        r['route_type'] = int(r['route_type']) if r.get('route_type') is not None else 3
    return records

def get_stops_for_route(route_short_name: str, direction: int, route_id: str = None) -> List[Dict]:
    """
    Получить список остановок для маршрута в определённом направлении
    
    Args:
        route_short_name: Номер маршрута
        direction: 0 - прямое, 1 - обратное
        route_id: ID маршрута (если передан — используется напрямую, без поиска)
    
    Returns:
        List[Dict]: Список остановок по порядку
    """
    try:
        con = get_connection()
        
        # Если route_id передан — используем его напрямую
        if not route_id:
            route_query = """
                SELECT route_id 
                FROM routes 
                WHERE route_short_name = ?
            """
            route_df = con.execute(route_query, [route_short_name]).df()
            
            if route_df.empty:
                con.close()
                return []
            
            route_id = str(route_df.iloc[0]['route_id'])
        
        direction_id = str(direction)
        
        print(f"Getting stops for route: {route_short_name}, route_id: {route_id}, direction: {direction_id}")
        
        # Получаем остановки
        query = """
            WITH route_trips AS (
                SELECT DISTINCT trip_id
                FROM trips
                WHERE CAST(route_id AS VARCHAR) = ?
                  AND CAST(direction_id AS VARCHAR) = ?
            ),
            stop_sequences AS (
                SELECT DISTINCT
                    st.stop_id,
                    MIN(st.stop_sequence) as min_sequence
                FROM stop_times st
                WHERE st.trip_id IN (SELECT trip_id FROM route_trips)
                GROUP BY st.stop_id
            )
            SELECT 
                s.stop_id,
                s.stop_name,
                s.stop_lat,
                s.stop_lon,
                ss.min_sequence as stop_sequence
            FROM stop_sequences ss
            JOIN stops s ON CAST(ss.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
            ORDER BY ss.min_sequence
        """
        
        df = con.execute(query, [route_id, direction_id]).df()
        con.close()
        
        print(f"Found {len(df)} stops")
        
        return df.to_dict('records')
    except Exception as e:
        print(f"❌ Error in get_stops_for_route: {e}")
        import traceback
        traceback.print_exc()
        return []

def get_route_schedule(
    route_short_name: str, 
    stop_name: str, 
    direction: int, 
    day_type: str,
    route_id: str = None
) -> List[str]:
    """
    Получить расписание для конкретной остановки
    
    Args:
        route_short_name: Номер маршрута
        stop_name: Название остановки
        direction: Направление (0 или 1)
        day_type: "weekday" или "weekend"
        route_id: ID маршрута (если передан — используется напрямую)
    
    Returns:
        List[str]: Отсортированный список времён прибытия
    """
    try:
        con = get_connection()
        
        # Если route_id передан — используем его напрямую
        if not route_id:
            route_df = con.execute(
                "SELECT route_id FROM routes WHERE route_short_name = ?",
                [route_short_name]
            ).df()
            
            if route_df.empty:
                con.close()
                return []
            
            route_id = str(route_df.iloc[0]['route_id'])
        
        direction_id = str(direction)
        day_column = 'monday' if day_type == 'weekday' else 'sunday'
        
        # Получаем расписание
        query = f"""
            WITH valid_services AS (
                SELECT CAST(service_id AS VARCHAR) as service_id
                FROM calendar 
                WHERE {day_column} = 1
            ),
            route_trips AS (
                SELECT DISTINCT t.trip_id
                FROM trips t
                WHERE CAST(t.route_id AS VARCHAR) = ?
                  AND CAST(t.direction_id AS VARCHAR) = ?
                  AND CAST(t.service_id AS VARCHAR) IN (SELECT service_id FROM valid_services)
            ),
            stops_with_name AS (
                SELECT 
                    st.trip_id,
                    CAST(st.stop_id AS VARCHAR) as stop_id,
                    st.stop_sequence,
                    st.arrival_time
                FROM stop_times st
                JOIN stops s ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
                WHERE st.trip_id IN (SELECT trip_id FROM route_trips)
                  AND s.stop_name = ?
            ),
            first_occurrence AS (
                SELECT 
                    trip_id,
                    MIN(stop_sequence) as min_seq
                FROM stops_with_name
                GROUP BY trip_id
            )
            SELECT DISTINCT swn.arrival_time
            FROM stops_with_name swn
            JOIN first_occurrence fo 
                ON swn.trip_id = fo.trip_id 
                AND swn.stop_sequence = fo.min_seq
            ORDER BY swn.arrival_time
        """
        
        df = con.execute(query, [route_id, direction_id, stop_name]).df()
        
        # Логи для отладки
        print(f"📊 get_route_schedule: route={route_short_name}, stop={stop_name}, direction={direction}, day_type={day_type}")
        print(f"   → Returned {len(df)} records from query")
        
        con.close()
        
        # Нормализуем время и сортируем
        times = []
        for time_str in df['arrival_time'].tolist():
            normalized = normalize_time(time_str)
            if normalized:
                times.append({
                    'time': normalized,
                    'sort_key': get_sort_key(normalized)
                })
        
        # Сортируем и удаляем дубликаты
        times_sorted = sorted(times, key=lambda x: x['sort_key'])
        unique_times = []
        seen = set()
        
        for item in times_sorted:
            if item['time'] not in seen:
                unique_times.append(item['time'])
                seen.add(item['time'])
        
        # Фильтруем фантомные рейсы (интервал < 3 минут)
        filtered_times = []
        for i, t in enumerate(unique_times):
            if i == 0:
                filtered_times.append(t)
                continue
            prev_key = get_sort_key(filtered_times[-1])
            curr_key = get_sort_key(t)
            diff = curr_key - prev_key
            # Учитываем переход через полночь
            if diff < 0:
                diff += 24 * 60
            if diff >= 3:
                filtered_times.append(t)
        
        return filtered_times
    except Exception as e:
        print(f"❌ Ошибка в get_route_schedule: {e}")
        import traceback
        traceback.print_exc()
        return []

def get_intervals_for_stop(
    route_short_name: str,
    stop_name: str,
    direction: int,
    day_type: str,
    route_id: str = None
) -> Optional[Dict]:
    # Получаем расписание, передавая route_id
    schedule = get_route_schedule(route_short_name, stop_name, direction, day_type, route_id)
    
    if not schedule:
        return None
    
    # Группируем по часам и рассчитываем интервалы
    hourly_intervals = {h: [] for h in range(24)}
    
    for i in range(1, len(schedule)):
        try:
            t1 = get_sort_key(schedule[i-1])
            t2 = get_sort_key(schedule[i])
            hour = int(schedule[i].split(':')[0])
            
            interval = t2 - t1
            if 0 < interval < 180:  # Игнорируем интервалы > 3 часов
                hourly_intervals[hour].append(interval)
        except:
            continue
    
    # Формируем результат
    hours = list(range(24))
    min_intervals = []
    max_intervals = []
    
    for h in hours:
        if hourly_intervals[h]:
            min_intervals.append(min(hourly_intervals[h]))
            max_intervals.append(max(hourly_intervals[h]))
        else:
            min_intervals.append(0)
            max_intervals.append(0)
    
    return {
        'hours': hours,
        'min_intervals': min_intervals,
        'max_intervals': max_intervals
    }

def get_trip_durations(
    route_short_name: str,
    direction: int,
    day_type: str,
    route_id: str = None
) -> Optional[Dict]:
    con = get_connection()
    
    # Если route_id не передан — ищем по имени
    if not route_id:
        route_df = con.execute(
            "SELECT route_id FROM routes WHERE route_short_name = ?",
            [route_short_name]
        ).df()
        
        if route_df.empty:
            con.close()
            return None
        
        route_id = str(route_df.iloc[0]['route_id'])
    
    direction_id = str(direction)
    day_column = 'monday' if day_type == 'weekday' else 'sunday'
    
    # Получаем рейсы
    query = f"""
        WITH valid_services AS (
            SELECT CAST(service_id AS VARCHAR) as service_id
            FROM calendar 
            WHERE {day_column} = 1
        ),
        route_trips AS (
            SELECT trip_id
            FROM trips
            WHERE CAST(route_id AS VARCHAR) = ?
              AND CAST(direction_id AS VARCHAR) = ?
              AND CAST(service_id AS VARCHAR) IN (SELECT service_id FROM valid_services)
        )
        SELECT 
            st.trip_id,
            MIN(st.arrival_time) as first_time,
            MAX(st.arrival_time) as last_time
        FROM stop_times st
        WHERE st.trip_id IN (SELECT trip_id FROM route_trips)
        GROUP BY st.trip_id
        HAVING COUNT(*) > 1
    """
    
    df = con.execute(query, [route_id, direction_id]).df()
    con.close()
    
    if df.empty:
        return None
    
    # Рассчитываем длительность
    durations = []
    
    for _, row in df.iterrows():
        try:
            first = row['first_time']
            last = row['last_time']
            
            # Конвертируем в минуты
            h1, m1 = map(int, str(first).split(':')[:2])
            h2, m2 = map(int, str(last).split(':')[:2])
            
            duration = (h2 * 60 + m2) - (h1 * 60 + m1)
            
            if 0 < duration < 300:  # Игнорируем > 5 часов
                durations.append({
                    'first_time': normalize_time(first),
                    'last_time': normalize_time(last),
                    'duration': duration
                })
        except:
            continue
    
    if not durations:
        return None
    
    # Статистика
    duration_values = [d['duration'] for d in durations]
    
    return {
        'average': sum(duration_values) / len(duration_values),
        'min': min(duration_values),
        'max': max(duration_values),
        'count': len(durations),
        'trips': durations[:50]  # Ограничиваем для производительности
    }

# =============================================================================
# ИНИЦИАЛИЗАЦИЯ БД (если нужно создать из CSV)
# =============================================================================

def init_database_from_csv(csv_folder_path: str):
    """
    Создаёт DuckDB базу из CSV файлов
    
    Используется при первом деплое на Render
    """
    print(f"📦 Создаём базу данных из CSV файлов в {csv_folder_path}")
    
    con = duckdb.connect(DB_PATH)
    
    # Список файлов и таблиц
    files = {
        'stops': 'data-60662.csv',
        'routes': 'data-60664.csv',
        'calendar': 'data-60666.csv',
        'trips': 'data-60665.csv',
        'stop_times': 'data-60661-extract.csv'
    }
    
    for table, filename in files.items():
        filepath = os.path.join(csv_folder_path, filename)
        
        if not os.path.exists(filepath):
            print(f"⚠️ Файл {filename} не найден, пропускаем")
            continue
        
        print(f"📊 Загружаем {table} из {filename}...")
        
        # Определяем разделитель
        delimiter = ';' if table != 'trips' else ';'
        
        con.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} AS 
            SELECT * FROM read_csv_auto('{filepath}', 
                delim='{delimiter}',
                header=true,
                normalize_names=true,
                ignore_errors=true)
        """)
        
        count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"✅ {table}: {count:,} записей")
    
    # Создаём индексы
    print("🔧 Создаём индексы...")
    
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id)",
        "CREATE INDEX IF NOT EXISTS idx_trips_direction ON trips(direction_id)",
        "CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id)",
        "CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id)",
        "CREATE INDEX IF NOT EXISTS idx_stops_name ON stops(stop_name)",
    ]
    
    for idx in indexes:
        con.execute(idx)
    
    con.close()
    print("🎉 База данных создана успешно!")

def search_stops(query: str, limit: int = 30) -> List[Dict]:
    """
    Поиск остановок по названию с маршрутами через них.
    Возвращает список остановок с маршрутами которые через них проходят.
    """
    try:
        con = get_connection()
        
        # Шаг 1: Найти уникальные имена остановок
        stop_names_df = con.execute("""
            SELECT DISTINCT s.stop_name
            FROM stops s
            WHERE s.stop_name ILIKE ?
            ORDER BY s.stop_name
            LIMIT ?
        """, [f'%{query}%', limit]).df()
        
        if stop_names_df.empty:
            con.close()
            return []
        
        stop_names = stop_names_df['stop_name'].tolist()
        
        # Шаг 2: Получить маршруты для найденных остановок
        placeholders = ','.join(['?' for _ in stop_names])
        df = con.execute(f"""
            SELECT DISTINCT
                s.stop_name,
                r.route_short_name,
                r.route_id,
                r.route_long_name,
                t.direction_id
            FROM stops s
            JOIN stop_times st ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
            JOIN trips t ON t.trip_id = st.trip_id
            JOIN routes r ON CAST(r.route_id AS VARCHAR) = CAST(t.route_id AS VARCHAR)
            WHERE s.stop_name IN ({placeholders})
            ORDER BY s.stop_name, r.route_short_name
        """, stop_names).df()
        
        con.close()
        
        if df.empty:
            return []
        
        # Группируем по остановке
        stops_map = {}
        for _, row in df.iterrows():
            stop_name = row['stop_name']
            if stop_name not in stops_map:
                stops_map[stop_name] = {
                    'stop_name': stop_name,
                    'routes': []
                }
            route_entry = {
                'route_short_name': str(row['route_short_name']),
                'route_id': str(row['route_id']),
                'route_long_name': str(row['route_long_name']) if row['route_long_name'] else '',
                'direction': int(row['direction_id'])
            }
            # Добавляем только уникальные маршруты
            existing = stops_map[stop_name]['routes']
            if not any(r['route_id'] == route_entry['route_id'] and r['direction'] == route_entry['direction'] for r in existing):
                existing.append(route_entry)
        
        result = list(stops_map.values())[:limit]
        return result
        
    except Exception as e:
        print(f"❌ Error in search_stops: {e}")
        return []


def get_nearby_stops(lat: float, lon: float, radius_m: int = 500) -> List[Dict]:
    """
    Найти ближайшие остановки в радиусе radius_m метров.
    Возвращает остановки с маршрутами, отсортированные по расстоянию.
    Маршруты группируются по ближайшей общей следующей остановке (direction_group).
    """
    try:
        con = get_connection()

        # 1. Основной запрос — остановки + маршруты
        df = con.execute("""
            WITH stop_distances AS (
                SELECT
                    s.stop_id,
                    s.stop_name,
                    s.stop_lat,
                    s.stop_lon,
                    6371000 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(s.stop_lat - ?) / 2), 2) +
                        COS(RADIANS(?)) * COS(RADIANS(s.stop_lat)) *
                        POWER(SIN(RADIANS(s.stop_lon - ?) / 2), 2)
                    )) AS distance_m
                FROM stops s
                WHERE
                    s.stop_lat BETWEEN ? - 0.009 AND ? + 0.009
                    AND s.stop_lon BETWEEN ? - 0.013 AND ? + 0.013
            ),
            filtered AS (
                SELECT * FROM stop_distances WHERE distance_m <= ?
            )
            SELECT
                f.stop_id,
                f.stop_name,
                ROUND(f.distance_m) AS distance_m,
                r.route_short_name,
                r.route_id,
                r.route_type,
                t.direction_id
            FROM filtered f
            JOIN stop_times st ON st.stop_id = f.stop_id
            JOIN trips t ON t.trip_id = st.trip_id
            JOIN routes r ON r.route_id = t.route_id
            GROUP BY f.stop_id, f.stop_name, f.distance_m, r.route_short_name, r.route_id, r.route_type, t.direction_id
            ORDER BY f.distance_m, r.route_short_name
        """, [lat, lat, lon, lat, lat, lon, lon, radius_m]).df()

        if df.empty:
            con.close()
            return []

        # Собираем уникальные stop_id
        stop_ids = [str(sid) for sid in df['stop_id'].unique().tolist()]

        # 2. Для каждого route+direction+stop находим 3 следующие остановки
        next_stops_map = {}
        try:
            placeholders = ','.join(['?' for _ in stop_ids])
            next_df = con.execute(f"""
                WITH relevant_trips AS (
                    SELECT DISTINCT t.trip_id, t.route_id, t.direction_id
                    FROM stop_times st
                    JOIN trips t ON t.trip_id = st.trip_id
                    WHERE CAST(st.stop_id AS VARCHAR) IN ({placeholders})
                ),
                sequenced AS (
                    SELECT
                        rt.route_id,
                        rt.direction_id,
                        st.stop_id,
                        st.stop_sequence,
                        rt.trip_id,
                        LEAD(st.stop_id, 1) OVER (PARTITION BY rt.trip_id ORDER BY st.stop_sequence) AS next1_id,
                        LEAD(st.stop_id, 2) OVER (PARTITION BY rt.trip_id ORDER BY st.stop_sequence) AS next2_id,
                        LEAD(st.stop_id, 3) OVER (PARTITION BY rt.trip_id ORDER BY st.stop_sequence) AS next3_id
                    FROM stop_times st
                    JOIN relevant_trips rt ON rt.trip_id = st.trip_id
                )
                SELECT DISTINCT
                    s.route_id,
                    s.direction_id,
                    s.stop_id,
                    s1.stop_name AS next1_name,
                    s2.stop_name AS next2_name,
                    s3.stop_name AS next3_name
                FROM sequenced s
                LEFT JOIN stops s1 ON s1.stop_id = s.next1_id
                LEFT JOIN stops s2 ON s2.stop_id = s.next2_id
                LEFT JOIN stops s3 ON s3.stop_id = s.next3_id
                WHERE CAST(s.stop_id AS VARCHAR) IN ({placeholders})
                  AND (s.next1_id IS NOT NULL OR s.next2_id IS NOT NULL)
            """, stop_ids + stop_ids).df()

            for _, row in next_df.iterrows():
                key = (str(row['route_id']), str(row['direction_id']), str(row['stop_id']))
                if key not in next_stops_map:
                    names = []
                    for col in ['next1_name', 'next2_name', 'next3_name']:
                        v = row.get(col)
                        if v is not None and str(v) != 'nan' and str(v) != 'None':
                            names.append(str(v))
                    next_stops_map[key] = names
        except Exception as e:
            print(f"⚠️ Next stops lookup failed (non-critical): {e}")

        con.close()

        # 3. Группируем по остановке и находим общие следующие остановки
        stops_map = {}
        for _, row in df.iterrows():
            stop_name = row['stop_name']
            stop_id = str(row['stop_id'])
            if stop_name not in stops_map:
                stops_map[stop_name] = {
                    'stop_name': stop_name,
                    'distance_m': int(row['distance_m']),
                    'routes': [],
                    '_stop_id': stop_id
                }
            route_id = str(row['route_id'])
            direction = int(row['direction_id'])
            route_entry = {
                'route_short_name': str(row['route_short_name']),
                'route_id': route_id,
                'route_type': int(row['route_type']) if row['route_type'] is not None else 3,
                'direction': direction,
                '_next_stops': next_stops_map.get((route_id, str(direction), stop_id), [])
            }
            existing = stops_map[stop_name]['routes']
            if not any(r['route_id'] == route_entry['route_id'] and r['direction'] == route_entry['direction'] for r in existing):
                existing.append(route_entry)

        # 4. Для каждой остановки — группировка маршрутов по общей следующей остановке
        result = []
        for stop_data in stops_map.values():
            routes = stop_data['routes']

            # Группируем по direction (0/1), затем внутри direction ищем общую остановку
            by_dir = {}
            for r in routes:
                by_dir.setdefault(r['direction'], []).append(r)

            for direction, dir_routes in by_dir.items():
                # Собираем все наборы следующих остановок
                route_next = {r['route_id']: r['_next_stops'] for r in dir_routes}

                # Находим общую остановку: для каждой остановки из next_stops считаем,
                # сколько маршрутов через неё проходят. Берём ту, что покрывает больше всех
                # и при этом ближе по позиции (приоритет: next1 > next2 > next3)
                stop_count = {}  # stop_name -> (count, sum_of_positions)
                for rid, nexts in route_next.items():
                    for pos, sname in enumerate(nexts):
                        if sname not in stop_count:
                            stop_count[sname] = [0, 0]
                        stop_count[sname][0] += 1
                        stop_count[sname][1] += pos

                if stop_count:
                    # Сортируем: больше маршрутов → лучше; при равенстве — ближе по позиции
                    best_common = max(stop_count.items(), key=lambda x: (x[1][0], -x[1][1]))
                    common_name = best_common[0]
                    common_count = best_common[1][0]
                else:
                    common_name = None
                    common_count = 0

                # Назначаем direction_group каждому маршруту
                for r in dir_routes:
                    nexts = r['_next_stops']
                    if common_name and common_name in nexts and common_count >= 2:
                        r['direction_group'] = common_name
                    elif nexts:
                        r['direction_group'] = nexts[0]  # первая следующая остановка
                    else:
                        r['direction_group'] = 'Прямое' if direction == 0 else 'Обратное'

            # Убираем служебные поля
            for r in routes:
                r.pop('_next_stops', None)

            stop_data.pop('_stop_id', None)
            result.append(stop_data)

        return result

    except Exception as e:
        print(f"❌ Error in get_nearby_stops: {e}")
        import traceback
        traceback.print_exc()
        return []


def get_transfers_at_stop(stop_name: str, exclude_route_id: str = None, day_type: str = 'weekday') -> List[Dict]:
    """
    Найти все маршруты, проходящие через остановку (для блока «Пересадки»).
    Исключает текущий маршрут. Возвращает route_short_name, route_id, route_type,
    direction, route_long_name и ближайшие 3 рейса.
    """
    try:
        con = get_connection()

        day_column = 'monday' if day_type == 'weekday' else 'sunday'

        query = f"""
            SELECT DISTINCT
                r.route_short_name,
                r.route_id,
                r.route_type,
                r.route_long_name,
                t.direction_id
            FROM stops s
            JOIN stop_times st ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
            JOIN trips t ON t.trip_id = st.trip_id
            JOIN routes r ON CAST(r.route_id AS VARCHAR) = CAST(t.route_id AS VARCHAR)
            JOIN calendar c ON CAST(c.service_id AS VARCHAR) = CAST(t.service_id AS VARCHAR)
            WHERE s.stop_name = ?
              AND c.{day_column} = 1
            ORDER BY r.route_short_name
        """
        df = con.execute(query, [stop_name]).df()
        con.close()

        if df.empty:
            return []

        results = []
        for _, row in df.iterrows():
            rid = str(row['route_id'])
            # Пропускаем текущий маршрут
            if exclude_route_id and rid == str(exclude_route_id):
                continue
            
            direction = int(row['direction_id'])
            
            # Получаем ближайшие рейсы
            schedule = get_route_schedule(
                str(row['route_short_name']),
                stop_name,
                direction,
                day_type,
                rid
            )

            # Находим ближайшие 3 рейса
            from datetime import datetime, timedelta, timezone
            moscow_tz = timezone(timedelta(hours=3))
            now = datetime.now(moscow_tz)
            now_h = now.hour
            now_m = now.minute
            normalized_now = (now_h + 24) * 60 + now_m if now_h < 4 else now_h * 60 + now_m

            upcoming = []
            for t in schedule:
                parts = t.split(':')
                if len(parts) < 2:
                    continue
                h, m = int(parts[0]), int(parts[1])
                total = (h + 24) * 60 + m if h < 4 else h * 60 + m
                if total >= normalized_now:
                    upcoming.append({'time': t[:5], 'diff_min': total - normalized_now})

            if not upcoming:
                continue

            # Проверяем дубликаты (тот же маршрут, другое направление — оставляем оба)
            route_name = str(row['route_short_name'])
            route_long = str(row['route_long_name']) if row['route_long_name'] else ''

            # Для обратного направления разворачиваем название
            if direction == 1 and ' - ' in route_long:
                parts = route_long.split(' - ')
                route_long = ' - '.join(reversed(parts))

            results.append({
                'route_short_name': route_name,
                'route_id': rid,
                'route_type': int(row['route_type']) if row['route_type'] is not None else 3,
                'route_long_name': route_long,
                'direction': direction,
                'next_times': upcoming
            })

        # Сортируем по ближайшему рейсу
        results.sort(key=lambda x: x['next_times'][0]['diff_min'] if x['next_times'] else 9999)

        return results

    except Exception as e:
        print(f"❌ Error in get_transfers_at_stop: {e}")
        import traceback
        traceback.print_exc()
        return []


# =============================================================================
# Тест подключения
# =============================================================================

if __name__ == "__main__":
    print("🧪 Тестирование подключения к БД...")
    
    try:
        routes = get_routes_list()
        print(f"✅ Найдено маршрутов: {len(routes)}")
        print(f"Первые 5: {[r['route_short_name'] for r in routes[:5]]}")
    except Exception as e:
        print(f"❌ Ошибка: {e}")
