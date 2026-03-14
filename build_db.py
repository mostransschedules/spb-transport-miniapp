#!/usr/bin/env python3
"""
build_db.py — Сборка gtfs_spb.duckdb из GTFS-фида Санкт-Петербурга
Запуск: python build_db.py [--gtfs-url URL] [--output gtfs_spb.duckdb]

Используется:
  - локально вручную
  - в GitHub Actions автоматически
"""

import argparse
import hashlib
import os
import sys
import zipfile
import io
import urllib.request
from pathlib import Path

GTFS_URL = "https://transport.orgp.spb.ru/Portal/transport/internalapi/gtfs/feed.zip"
DEFAULT_OUTPUT = "gtfs_spb.duckdb"
HASH_FILE = "gtfs_hash.txt"

# GTFS txt → имя таблицы
GTFS_FILES = [
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
    "shapes.txt",
]

def download_gtfs(url: str) -> bytes:
    print(f"⬇️  Скачиваем GTFS: {url}")
    # transport.orgp.spb.ru использует самоподписанный сертификат — verify=False
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "SPB-Transport-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
        data = r.read()
    print(f"   Размер: {len(data) / 1024 / 1024:.1f} MB")
    return data


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_prev_hash(path: str) -> str:
    try:
        return Path(path).read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        return ""


def save_hash(data: bytes, path: str):
    Path(path).write_text(file_hash(data), encoding='utf-8')


def build_database(zip_bytes: bytes, output_path: str):
    import duckdb

    print(f"🏗️  Строим базу данных → {output_path}")

    # Удаляем старую БД если есть
    if os.path.exists(output_path):
        os.remove(output_path)

    con = duckdb.connect(output_path)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        available = {name.split("/")[-1]: name for name in zf.namelist()}
        print(f"   Файлов в архиве: {len(available)}")

        for fname in GTFS_FILES:
            if fname not in available:
                print(f"   ⚠️  {fname} — не найден, пропускаем")
                continue

            table = fname.replace(".txt", "")
            raw = zf.read(available[fname])
            # Сохраняем во временный файл (DuckDB read_csv нужен путь)
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=f"_{fname}", delete=False, mode='wb') as tf:
                tf.write(raw)
                tmp_path = tf.name

            # DuckDB на Windows требует слеши прямые
            tmp_path_fwd = tmp_path.replace("\\", "/")

            print(f"   📊 {fname} → таблица '{table}'")
            try:
                con.execute(f"""
                    CREATE TABLE {table} AS
                    SELECT * FROM read_csv_auto(
                        '{tmp_path_fwd}',
                        header=true,
                        normalize_names=true,
                        ignore_errors=true
                    )
                """)
                count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                print(f"      {count:,} строк")
            except Exception as e:
                print(f"   ❌ Ошибка при загрузке {fname}: {e}")
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

    # Индексы для производительности
    print("   🔧 Создаём индексы...")
    indexes = [
        ("stop_times", "trip_id"),
        ("stop_times", "stop_id"),
        ("trips", "route_id"),
        ("trips", "trip_id"),
        ("stops", "stop_id"),
    ]
    for table, col in indexes:
        try:
            con.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_{col} ON {table} ({col})")
        except Exception:
            pass

    # Проверяем результат
    print("\n📋 Итог:")
    for fname in GTFS_FILES:
        table = fname.replace(".txt", "")
        try:
            count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"   {table:20s} {count:>10,} строк")
        except Exception:
            print(f"   {table:20s} — отсутствует")

    con.close()
    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"\n✅ База готова: {output_path} ({size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Сборка GTFS DuckDB для SPB Transport")
    parser.add_argument("--gtfs-url", default=GTFS_URL, help="URL GTFS ZIP-архива")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Путь к выходному .duckdb файлу")
    parser.add_argument("--hash-file", default=HASH_FILE, help="Файл с хэшем предыдущего фида")
    parser.add_argument("--force", action="store_true", help="Пересобрать даже если фид не изменился")
    parser.add_argument("--check-only", action="store_true", help="Только проверить, изменился ли фид")
    args = parser.parse_args()

    zip_bytes = download_gtfs(args.gtfs_url)
    current_hash = file_hash(zip_bytes)
    prev_hash = read_prev_hash(args.hash_file)

    print(f"\n🔍 Хэш текущего фида:    {current_hash[:16]}...")
    print(f"   Хэш предыдущего фида: {prev_hash[:16] if prev_hash else '(нет)'}...")

    if args.check_only:
        changed = current_hash != prev_hash
        print(f"\n{'✅ Фид изменился' if changed else '⏭️  Фид не изменился'}")
        # Для GitHub Actions: выводим переменную
        gha_output = os.environ.get("GITHUB_OUTPUT")
        if gha_output:
            with open(gha_output, "a") as f:
                f.write(f"changed={'true' if changed else 'false'}\n")
                f.write(f"hash={current_hash}\n")
        sys.exit(0 if changed else 2)  # exit 2 = не изменился

    if current_hash == prev_hash and not args.force:
        print("\n⏭️  Фид не изменился — пересборка не нужна")
        gha_output = os.environ.get("GITHUB_OUTPUT")
        if gha_output:
            with open(gha_output, "a") as f:
                f.write("changed=false\n")
                f.write(f"hash={current_hash}\n")
        sys.exit(0)

    build_database(zip_bytes, args.output)
    save_hash(zip_bytes, args.hash_file)

    # Для GitHub Actions
    gha_output = os.environ.get("GITHUB_OUTPUT")
    if gha_output:
        with open(gha_output, "a") as f:
            f.write("changed=true\n")
            f.write(f"hash={current_hash}\n")
            f.write(f"db_path={args.output}\n")

    print("\n🎉 Готово!")


if __name__ == "__main__":
    main()
