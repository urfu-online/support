#!/bin/bash
# =============================================================================
# Скрипт подготовки к бэкапу
# Вызывается перед созданием бэкапа платформенным сервисом backup
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Подготовка к бэкапу Support ==="

# Остановка worker для консистентности данных
echo "[*] Остановка zammad-worker..."
docker compose stop zammad-worker || true

# Создание дампа PostgreSQL
echo "[*] Создание дампа PostgreSQL..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/support_backup"
mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump -U zammad zammad > "$BACKUP_DIR/zammad_db.sql"

# Синхронизация файлов Zammad
echo "[*] Синхронизация файлов Zammad..."
if [ -d "./data/zammad" ]; then
    rsync -a --delete ./data/zammad/ "$BACKUP_DIR/zammad_files/" 2>/dev/null || true
fi

# Запуск worker
echo "[*] Запуск zammad-worker..."
docker compose start zammad-worker || true

echo ""
echo "=== Подготовка завершена ==="
echo "Бэкап готов к созданию в $BACKUP_DIR"
