#!/bin/bash
# =============================================================================
# Скрипт восстановления из бэкапа
# Использование: ./scripts/restore.sh <BACKUP_DATE>
# Пример: ./scripts/restore.sh 20240101_020000
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Проверка аргумента
if [ -z "$1" ]; then
    echo "Использование: $0 <BACKUP_DATE>"
    echo "Пример: $0 20240101_020000"
    echo ""
    echo "Доступные бэкапы:"
    ls -la /tmp/support_backup/ 2>/dev/null || echo "  (нет доступных бэкапов)"
    exit 1
fi

BACKUP_DATE=$1
BACKUP_DIR="/tmp/support_backup/$BACKUP_DATE"

# Проверка существования бэкапа
if [ ! -d "$BACKUP_DIR" ]; then
    echo "[!] Бэкап не найден: $BACKUP_DIR"
    exit 1
fi

echo "=== Восстановление Support из бэкапа: $BACKUP_DATE ==="

# Остановка сервиса
echo "[*] Остановка сервиса..."
docker compose down

# Восстановление PostgreSQL
echo "[*] Восстановление PostgreSQL..."
if [ -f "$BACKUP_DIR/zammad_db.sql" ]; then
    # Очистка существующей БД
    docker compose run --rm postgres dropdb -U zammad zammad 2>/dev/null || true
    docker compose run --rm postgres createdb -U zammad zammad
    
    # Импорт дампа
    cat "$BACKUP_DIR/zammad_db.sql" | docker compose exec -T postgres psql -U zammad zammad
    echo "[+] PostgreSQL восстановлен"
else
    echo "[!] Файл дампа не найден: $BACKUP_DIR/zammad_db.sql"
fi

# Восстановление файлов Zammad
echo "[*] Восстановление файлов Zammad..."
if [ -d "$BACKUP_DIR/zammad_files" ]; then
    rsync -a --delete "$BACKUP_DIR/zammad_files/" ./data/zammad/
    echo "[+] Файлы Zammad восстановлены"
else
    echo "[!] Директория с файлами не найдена: $BACKUP_DIR/zammad_files"
fi

# Восстановление Elasticsearch (пересоздание индексов)
echo "[*] Очистка индексов Elasticsearch..."
docker compose up -d elasticsearch
sleep 10
curl -X DELETE "http://localhost:9200/zammad_*" 2>/dev/null || true

# Запуск сервиса
echo "[*] Запуск сервиса..."
docker compose up -d

# Ожидание готовности
echo "[*] Ожидание готовности сервисов..."
sleep 30

# Проверка здоровья
echo "[*] Проверка здоровья..."
docker compose ps

echo ""
echo "=== Восстановление завершено ==="
echo "Проверьте логи: ops logs support"
