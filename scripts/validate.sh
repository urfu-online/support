#!/bin/bash
# =============================================================================
# Скрипт валидации конфигурации сервиса
# Проверяет docker-compose.yml, service.yml и переменные окружения
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVICE_DIR"

ERRORS=0
WARNINGS=0

echo "=== Валидация конфигурации Support ==="

# =============================================================================
# 1. Проверка docker-compose.yml
# =============================================================================
echo ""
echo "[1/5] Проверка docker-compose.yml..."
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    if docker compose config --quiet 2>/dev/null; then
        echo "  [✓] docker-compose.yml валиден"
    else
        echo "  [✗] Ошибка в docker-compose.yml:"
        docker compose config 2>&1 | head -20
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "  [⚠] Docker не доступен — пропуск проверки docker-compose.yml"
    WARNINGS=$((WARNINGS + 1))
fi

# =============================================================================
# 2. Проверка service.yml
# =============================================================================
echo ""
echo "[2/5] Проверка service.yml..."
if command -v yamllint &> /dev/null; then
    if yamllint -d relaxed service.yml 2>/dev/null; then
        echo "  [✓] service.yml валиден"
    else
        echo "  [✗] Ошибка в service.yml"
        ERRORS=$((ERRORS + 1))
    fi
else
    # Базовая проверка без yamllint
    if grep -q "^name:" service.yml && grep -q "^type:" service.yml; then
        echo "  [✓] service.yml содержит обязатель поля"
    else
        echo "  [✗] service.yml не содержит обязательных полей (name, type)"
        ERRORS=$((ERRORS + 1))
    fi
fi

# =============================================================================
# 3. Проверка .env файла
# =============================================================================
echo ""
echo "[3/5] Проверка .env..."
if [ -f ".env" ]; then
    # Проверка на наличие changeme
    CHANGEME_COUNT=$(grep -c "changeme" .env 2>/dev/null || true)
    if [ "$CHANGEME_COUNT" -eq 0 ]; then
        echo "  [✓] .env не содержит changeme значений"
    else
        echo "  [⚠] .env содержит $CHANGEME_COUNT не настроенных секретов"
        grep "changeme" .env | cut -d'=' -f1 | sed 's/^/      - /'
        WARNINGS=$((WARNINGS + 1))
    fi

    # Проверка обязательных переменных
    REQUIRED_VARS=("ZAMMAD_RAILS_SECRET" "ZAMMAD_SESSION_SECRET" "POSTGRES_PASSWORD" "POSTGRES_USER")
    for var in "${REQUIRED_VARS[@]}"; do
        if ! grep -q "^${var}=" .env 2>/dev/null; then
            echo "  [✗] Отсутствует обязательная переменная: $var"
            ERRORS=$((ERRORS + 1))
        fi
    done
    if [ "$ERRORS" -eq 0 ]; then
        echo "  [✓] Все обязательные переменные присутствуют"
    fi
else
    echo "  [✗] .env файл не найден. Выполните: cp .env.example .env"
    ERRORS=$((ERRORS + 1))
fi

# =============================================================================
# 4. Проверка директорий данных
# =============================================================================
echo ""
echo "[4/5] Проверка директорий..."
REQUIRED_DIRS=("data/postgres" "data/redis" "data/elasticsearch" "data/zammad" "logs")
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "  [✓] $dir существует"
    else
        echo "  [✗] $dir не существует"
        ERRORS=$((ERRORS + 1))
    fi
done

# =============================================================================
# 5. Проверка скриптов
# =============================================================================
echo ""
echo "[5/5] Проверка скриптов..."
REQUIRED_SCRIPTS=("scripts/init-secrets.sh" "scripts/init.sh" "scripts/prepare-backup.sh" "scripts/restore.sh")
for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        if [ -x "$script" ]; then
            echo "  [✓] $script существует и исполняемый"
        else
            echo "  [⚠] $script существует, но не исполняемый"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo "  [✗] $script не найден"
        ERRORS=$((ERRORS + 1))
    fi
done

# =============================================================================
# Итог
# =============================================================================
echo ""
echo "================================"
echo "Результат валидации:"
echo "  Ошибки: $ERRORS"
echo "  Предупреждения: $WARNINGS"
echo "================================"

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo "❌ Обнаружены ошибки. Исправьте их перед запуском сервиса."
    exit 1
elif [ "$WARNINGS" -gt 0 ]; then
    echo ""
    echo "⚠️  Есть предупреждения. Сервис может работать, но рекомендуется их устранить."
    exit 0
else
    echo ""
    echo "✅ Все проверки пройдены успешно!"
    exit 0
fi
