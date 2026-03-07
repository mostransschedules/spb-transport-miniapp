"""
Сборка DuckDB из GTFS-файлов Санкт-Петербурга
Запуск: python scripts/build_duckdb.py backend/feed
Результат: backend/gtfs_spb.duckdb

Особенность СПб GTFS:
  - route_type: 0=трамвай, 3=автобус И троллейбус (!)
  - transport_type: 'bus', 'trolley', 'tram' — РЕАЛЬНЫЙ тип транспорта
  - Троллейбусы НЕ имеют route_type=5, они route_type=3 + transport_type='trolley'
"""

import duckdb
import os
import sys
import time

def build_database(gtfs_folder: str, output_path: str = None):
    if not os.path.exists(gtfs_folder):
        print(f"❌ Папка {gtfs_folder} не найдена")
        sys.exit(1)

    if output_path is None:
        output_path = os.path.join(os.path.dirname(gtfs_folder), "gtfs_spb.duckdb")

    # Удалить старую БД если есть
    if os.path.exists(output_path):
        os.remove(output_path)
        print(f"🗑️  Удалена старая БД: {output_path}")

    print(f"📦 Сборка DuckDB из {gtfs_folder}")
    print(f"📁 Результат: {output_path}")
    start = time.time()

    con = duckdb.connect(output_path)

    # Таблицы для загрузки
    tables = {
        "agency":          "agency.txt",
        "routes":          "routes.txt",
        "stops":           "stops.txt",
        "trips":           "trips.txt",
        "stop_times":      "stop_times.txt",
        "calendar":        "calendar.txt",
        "calendar_dates":  "calendar_dates.txt",
        "shapes":          "shapes.txt",
        "frequencies":     "frequencies.txt",
        "feed_info":       "feed_info.txt",
    }

    for table_name, filename in tables.items():
        filepath = os.path.join(gtfs_folder, filename)
        if not os.path.exists(filepath):
            print(f"  ⚠️  {filename} не найден, пропускаем")
            continue

        print(f"  📊 Загружаем {table_name} из {filename}...", end=" ", flush=True)
        t0 = time.time()

        con.execute(f"""
            CREATE TABLE {table_name} AS
            SELECT * FROM read_csv_auto(
                '{filepath.replace(os.sep, "/")}',
                header=true,
                normalize_names=true,
                ignore_errors=true,
                all_varchar=false
            )
        """)

        count = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        dt = time.time() - t0
        print(f"✅ {count:,} записей ({dt:.1f}с)")

    # =========================================================================
    # ФИКС: Нормализация transport_type в routes
    # =========================================================================
    print("\n🔧 Нормализация transport_type...")

    try:
        cols = [r[0] for r in con.execute("DESCRIBE routes").fetchall()]
        if 'transport_type' in cols:
            con.execute("""
                UPDATE routes
                SET transport_type = CASE
                    WHEN transport_type IN ('bus', 'trolley', 'tram') THEN transport_type
                    WHEN route_type = 0 THEN 'tram'
                    ELSE 'bus'
                END
            """)

            stats = con.execute("""
                SELECT transport_type, COUNT(*) as cnt
                FROM routes GROUP BY transport_type ORDER BY cnt DESC
            """).fetchall()
            for tt, cnt in stats:
                print(f"  {tt}: {cnt} маршрутов")
        else:
            print("  ⚠️  Поле transport_type не найдено, создаём из route_type")
            con.execute("ALTER TABLE routes ADD COLUMN transport_type VARCHAR")
            con.execute("""
                UPDATE routes SET transport_type = CASE
                    WHEN route_type = 0 THEN 'tram'
                    WHEN route_type = 5 THEN 'trolley'
                    ELSE 'bus'
                END
            """)
    except Exception as e:
        print(f"  ⚠️  Ошибка нормализации: {e}")

    # =========================================================================
    # Индексы
    # =========================================================================
    print("\n🔧 Создаём индексы...")
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_routes_short_name ON routes(route_short_name)",
        "CREATE INDEX IF NOT EXISTS idx_routes_transport_type ON routes(transport_type)",
        "CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id)",
        "CREATE INDEX IF NOT EXISTS idx_trips_direction ON trips(direction_id)",
        "CREATE INDEX IF NOT EXISTS idx_trips_service ON trips(service_id)",
        "CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id)",
        "CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id)",
        "CREATE INDEX IF NOT EXISTS idx_stops_name ON stops(stop_name)",
        "CREATE INDEX IF NOT EXISTS idx_calendar_service ON calendar(service_id)",
    ]
    for idx in indexes:
        try:
            con.execute(idx)
        except Exception as e:
            print(f"  ⚠️  Индекс не создан: {e}")
    print("  ✅ Индексы созданы")

    # =========================================================================
    # Статистика
    # =========================================================================
    print("\n📊 Статистика:")
    for table_name in tables.keys():
        try:
            count = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
            print(f"  {table_name}: {count:,}")
        except:
            pass

    print("\n🔍 Проверка данных СПб (по transport_type):")
    try:
        tt_stats = con.execute("""
            SELECT transport_type, COUNT(*) as cnt
            FROM routes GROUP BY transport_type ORDER BY cnt DESC
        """).fetchall()
        for tt, cnt in tt_stats:
            emoji = {"bus": "🚌", "trolley": "🚎", "tram": "🚊"}.get(tt, "❓")
            print(f"  {emoji} {tt}: {cnt} маршрутов")
    except Exception as e:
        print(f"  ⚠️  {e}")

    print("\n🔍 Дополнительные поля СПб:")
    for field in ['circular', 'urban', 'night']:
        try:
            count = con.execute(f"SELECT COUNT(*) FROM routes WHERE {field} = 1").fetchone()[0]
            emoji = {"circular": "🔄", "urban": "🏙️", "night": "🌙"}.get(field, "")
            print(f"  {emoji} {field}=1: {count} маршрутов")
        except:
            pass

    print("\n📋 Примеры маршрутов:")
    try:
        for tt in ['bus', 'trolley', 'tram']:
            sample = con.execute(f"""
                SELECT route_short_name, route_long_name, transport_type
                FROM routes WHERE transport_type = '{tt}'
                ORDER BY route_short_name LIMIT 3
            """).fetchall()
            emoji = {"bus": "🚌", "trolley": "🚎", "tram": "🚊"}[tt]
            print(f"  {emoji} {tt}:")
            for name, long_name, _ in sample:
                print(f"    {name}: {long_name}")
    except:
        pass

    con.close()

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    total = time.time() - start
    print(f"\n🎉 Готово! {output_path} ({size_mb:.1f} MB) за {total:.1f}с")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python scripts/build_duckdb.py <путь_к_gtfs_папке>")
        print("Пример: python scripts/build_duckdb.py backend/feed")
        sys.exit(1)

    folder = sys.argv[1]
    build_database(folder)
