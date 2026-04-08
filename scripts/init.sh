#!/bin/bash
# =============================================================================
# Скрипт инициализации сервиса Support
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVICE_DIR"

echo "=== Инициализация сервиса Support ==="

# Проверка наличия .env
if [ ! -f .env ]; then
    echo "[!] .env не найден. Копируем из .env.example..."
    cp .env.example .env
    echo "[+] .env создан. Отредактируйте его перед запуском."
fi

# Генерация секретов если они ещё дефолтные
if grep -q "changeme_generate_random_32_chars" .env; then
    echo "[*] Генерация ZAMMAD_RAILS_SECRET..."
    SECRET=$(openssl rand -hex 16)
    sed -i "s/ZAMMAD_RAILS_SECRET=.*/ZAMMAD_RAILS_SECRET=$SECRET/" .env
fi

if grep -q "changeme_generate_secure_password" .env; then
    echo "[*] Генерация POSTGRES_PASSWORD..."
    PASSWORD=$(openssl rand -base64 24 | tr -d '=+')
    sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PASSWORD/" .env
fi

# Создание директорий для данных
echo "[*] Создание директорий для данных..."
mkdir -p "$SERVICE_DIR"/data/postgres/data "$SERVICE_DIR"/data/postgres/init
mkdir -p "$SERVICE_DIR"/data/redis/data
mkdir -p "$SERVICE_DIR"/data/elasticsearch/data
mkdir -p "$SERVICE_DIR"/data/zammad/data
mkdir -p "$SERVICE_DIR"/logs/zammad "$SERVICE_DIR"/logs/zammad-worker
chmod -R 755 "$SERVICE_DIR"/data "$SERVICE_DIR"/logs

# Проверка network
echo "[*] Проверка platform_network..."
if ! docker network ls | grep -q platform_network; then
    echo "[!] platform_network не найден. Создаём..."
    docker network create platform_network
fi

# Проверка Docker
echo "[*] Проверка Docker..."
if ! docker info &>/dev/null; then
    echo "[!] Docker не доступен. Проверьте установку."
    exit 1
fi

echo ""
echo "=== Инициализация завершена ==="
echo ""
echo "Следующие шаги:"
echo "1. Отредактируйте .env и установите реальные значения:"
echo "   - EMAIL_IMAP_PASSWORD"
echo "   - EMAIL_SMTP_PASSWORD"
echo "   - KEYCLOAK_CLIENT_SECRET (получить из Keycloak)"
echo ""
echo "2. Запустите сервис:"
echo "   ops up support"
echo ""
echo "3. Откройте https://help.openedu.urfu.ru для начальной настройки"
