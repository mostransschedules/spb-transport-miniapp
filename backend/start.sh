#!/bin/bash
# =============================================================================
# start.sh — Запуск backend на Render
# Скачивает актуальную БД из GitHub Releases (тег gtfs-latest)
# =============================================================================

DB_FILE="gtfs_spb.duckdb"
REPO="mostransschedules/spb-transport-miniapp"
RELEASE_TAG="gtfs-latest"
DB_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${DB_FILE}"
MIN_SIZE=50000000  # 50 MB минимум

CURRENT_SIZE=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)

if [ ! -f "$DB_FILE" ] || [ "$CURRENT_SIZE" -lt "$MIN_SIZE" ]; then
    echo "⬇️  Скачиваем актуальную БД с GitHub Releases..."
    echo "   URL: $DB_URL"
    curl -L --progress-bar "$DB_URL" -o "$DB_FILE"

    NEW_SIZE=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)

    if [ "$NEW_SIZE" -lt "$MIN_SIZE" ]; then
        echo "❌ ОШИБКА: БД слишком маленькая ($NEW_SIZE байт)"
        exit 1
    fi

    echo "✅ БД скачана: $(du -h $DB_FILE | cut -f1)"
else
    echo "✅ БД уже есть: $(du -h $DB_FILE | cut -f1)"
fi

# Запускаем сервер
echo "🚀 Запускаем FastAPI..."
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8000} \
    --workers 1
