#!/bin/bash

DB_FILE="gtfs_spb.duckdb"
DB_URL="https://github.com/mostransschedules/spb-transport-miniapp/releases/download/v1.0/gtfs_spb.duckdb"

MIN_SIZE=100000000  # 100 MB минимум

# Проверяем есть ли БД нормального размера
CURRENT_SIZE=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)

if [ ! -f "$DB_FILE" ] || [ "$CURRENT_SIZE" -lt "$MIN_SIZE" ]; then
    echo "⬇️ Скачиваем базу данных с GitHub Releases..."
    echo "   URL: $DB_URL"
    curl -L --progress-bar "$DB_URL" -o "$DB_FILE"
    
    NEW_SIZE=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)
    echo "✅ БД скачана: $(du -h $DB_FILE | cut -f1)"
    
    if [ "$NEW_SIZE" -lt "$MIN_SIZE" ]; then
        echo "❌ ОШИБКА: БД слишком маленькая ($NEW_SIZE байт), что-то пошло не так!"
        exit 1
    fi
else
    echo "✅ БД уже есть: $(du -h $DB_FILE | cut -f1)"
fi

echo "🚀 Запускаем сервер..."
uvicorn main:app --host 0.0.0.0 --port $PORT
