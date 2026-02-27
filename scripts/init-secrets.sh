#!/bin/bash
# =============================================================================
# Скрипт генерации безопасных секретов
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

echo "=== Генерация секретов для Support ==="

# Проверка существования .env
if [ ! -f "$ENV_FILE" ]; then
    echo "[!] $ENV_FILE не найден. Копируем из $ENV_EXAMPLE..."
    cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

# Функция проверки и замены
replace_if_changeme() {
    local key=$1
    local value=$2
    
    if grep -q "${key}=changeme" "$ENV_FILE"; then
        echo "[*] Генерация $key..."
        sed -i "s/${key}=.*/${key}=${value}/" "$ENV_FILE"
    else
        echo "[✓] $key уже установлен"
    fi
}

# Генерация секретов
replace_if_changeme "ZAMMAD_RAILS_SECRET" "$(openssl rand -hex 16)"
replace_if_changeme "ZAMMAD_SESSION_SECRET" "$(openssl rand -hex 16)"
replace_if_changeme "POSTGRES_PASSWORD" "$(openssl rand -base64 24 | tr -d '=+/')"

echo ""
echo "=== Генерация завершена ==="
echo ""
echo "Важно: Установите следующие значения вручную:"
echo "  - EMAIL_IMAP_PASSWORD"
echo "  - EMAIL_SMTP_PASSWORD"
echo "  - KEYCLOAK_CLIENT_SECRET"
echo ""
echo "Просмотрите .env и обновите при необходимости."
