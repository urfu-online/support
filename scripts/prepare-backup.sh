#!/bin/bash
# =============================================================================
# Скрипт подготовки к бэкапу
# Вызывается перед созданием бэкапа платформенным сервисом backup
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVICE_DIR"

# Гарантируем восстановление worker при выходе
trap 'echo "[*] Восстановление zammad-worker..."; docker compose start zammad-worker 2>/dev/null || true' EXIT ERR

echo "=== Подготовка к бэкапу Support ==="

# Остановка worker для консистентности данных
echo "[*] Остановка zammad-worker..."
docker compose stop zammad-worker 2>/dev/null || true

# Создание дампа PostgreSQL
echo "[*] Создание дампа PostgreSQL..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/support_backup"
mkdir -p "$BACKUP_DIR"

if docker compose exec -T postgres pg_dump -U zammad zammad > "$BACKUP_DIR/zammad_db.sql"; then
    echo "[+] Дамп PostgreSQL создан: $BACKUP_DIR/zammad_db.sql"
else
    echo "[!] Ошибка создания дампа PostgreSQL"
    exit 1
fi

# Синхронизация файлов Zammad
echo "[*] Синхронизация файлов Zammad..."
if [ -d "./data/zammad" ]; then
    if rsync -a --delete ./data/zammad/ "$BACKUP_DIR/zammad_files/" 2>/dev/null; then
        echo "[+] Файлы Zammad синхронизированы"
    else
        echo "[!] Ошибка синхронизации файлов Zammad"
    fi
else
    echo "[!] Директория data/zammad не найдена"
fi

echo ""
echo "=== Подготовка завершена ==="
echo "Бэкап готов к созданию в $BACKUP_DIR"
