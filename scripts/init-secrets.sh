#!/bin/bash
# =============================================================================
# Скрипт генерации безопасных секретов
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVICE_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

echo "=== Генерация секретов для Support ==="

# Проверка наличия openssl
if ! command -v openssl &> /dev/null; then
    echo "[!] openssl не найден. Установите openssl для генерации секретов."
    exit 1
fi

# Проверка существования .env
if [ ! -f "$ENV_FILE" ]; then
    echo "[!] $ENV_FILE не найден. Копируем из $ENV_EXAMPLE..."
    if ! cp "$ENV_EXAMPLE" "$ENV_FILE"; then
        echo "[!] Ошибка копирования $ENV_EXAMPLE → $ENV_FILE"
        exit 1
    fi
    echo "[+] $ENV_FILE создан"
fi

# Функция проверки и замены секрета
replace_if_changeme() {
    local key=$1
    local value=$2

    if grep -q "${key}=changeme" "$ENV_FILE" 2>/dev/null; then
        echo "[*] Генерация $key..."
        if sed -i "s|${key}=.*|${key}=${value}|" "$ENV_FILE"; then
            echo "[✓] $key сгенерирован"
        else
            echo "[!] Ошибка обновления $key"
            return 1
        fi
    elif grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
        echo "[✓] $key уже установлен"
    else
        echo "[!] $key не найден в $ENV_FILE"
    fi
}

# Генерация секретов
replace_if_changeme "ZAMMAD_RAILS_SECRET" "$(openssl rand -hex 16)"
replace_if_changeme "ZAMMAD_SESSION_SECRET" "$(openssl rand -hex 16)"
replace_if_changeme "POSTGRES_PASSWORD" "$(openssl rand -base64 24 | tr -d '=+/')"

# Проверка, остались ли ещё changeme значения
if grep -q "changeme" "$ENV_FILE" 2>/dev/null; then
    echo ""
    echo "⚠️  Внимание: следующие секреты требуют ручной настройки:"
    grep "changeme" "$ENV_FILE" | cut -d'=' -f1 | sed 's/^/  - /'
    echo ""
    echo "Отредактируйте $ENV_FILE и установите реальные значения."
fi

echo ""
echo "=== Генерация завершена ==="
