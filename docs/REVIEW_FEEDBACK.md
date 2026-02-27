# Рецензия на проект сервиса Support

**Дата:** 27 февраля 2026 г.  
**Статус:** Анализ проектной документации и артефактов

---

## 1. Общее впечатление

Проект хорошо структурирован и документирован. Видно системное мышление при проектировании. Большинство решений разумны и соответствуют best practices. Однако есть ряд моментов, требующих доработки или уточнения.

**Оценка общей готовности:** 75-80%

---

## 2. Критические замечания

### 2.1. Elasticsearch — перерасход памяти ⚠️

**Проблема:** В `docker-compose.yml` и `jvm.options` указано:
```yaml
ES_JAVA_OPTS=-Xms2g -Xmx2g
```
```
-Xms2g
-Xmx2g
```

При этом в `service.yml` общий лимит памяти сервиса:
```yaml
resources:
  memory_limit: 6Gi
```

**Расчёт:**
- zammad-web: 2Gi
- zammad-worker: 1Gi
- postgres: 1Gi
- redis: 512Mi
- elasticsearch: 2Gi (heap) + ~500Mi (overhead) = **2.5Gi**
- **Итого:** 7Gi+ (превышает лимит 6Gi)

**Рекомендация:**
1. Уменьшить heap Elasticsearch до **1.5g** (достаточно для <100K документов)
2. Или увеличить общий лимит до **8Gi**
3. Добавить мониторинг实际使用 памяти перед production запуском

---

### 2.2. Отсутствие миграции данных между версиями Zammad ⚠️

**Проблема:** В `IMPLEMENTATION_PLAN.md` и `MAINTENANCE.md` не описана процедура обновления между мажорными версиями Zammad.

**Рекомендация:**
1. Добавить раздел "Обновление версий" в `DEPLOYMENT.md`
2. Указать, что Zammad требует последовательного прохождения миграций (нельзя прыгнуть с 7.0 на 7.3)
3. Добавить скрипт `scripts/upgrade.sh` с проверкой совместимости версий

---

### 2.3. Секреты в .env файле ⚠️

**Проблема:** `.env` файл с реальными паролями может попасть в git, несмотря на `.gitignore`.

**Рекомендация:**
1. Добавить pre-commit hook для проверки на наличие `changeme` и реальных секретов
2. Рассмотреть использование Docker secrets или внешнего vault (HashiCorp Vault)
3. В `init-secrets.sh` добавить проверку, что `.env` не содержит `changeme`

---

## 3. Замечания средней важности

### 3.1. Health Check для zammad-worker

**Проблема:** В `docker-compose.yml`:
```yaml
healthcheck:
  test: ["CMD", "pgrep", "-f", "zammad-worker"]
```

Этот health check проверяет только наличие процесса, но не его работоспособность.

**Рекомендация:**
```yaml
healthcheck:
  test: ["CMD", "zammad", "execute", "System::StatusCheck"]
  interval: 30s
  timeout: 10s
  retries: 3
```

Или использовать проверку очереди Redis:
```yaml
healthcheck:
  test: ["CMD", "redis-cli", "-h", "redis", "llen", "sidekiq:queue"]
```

---

### 3.2. Отсутствие rate limiting для API

**Проблема:** В документации не упомянуто ограничение частоты запросов к API.

**Рекомендация:**
1. Добавить в `service.yml`:
```yaml
routing:
  - type: domain
    domain: help.openedu.urfu.ru
    internal_port: 80
    rate_limit:
      requests: 100
      period: 1m
```

2. Или настроить rate limiting в Caddy на уровне платформы

---

### 3.3. Недостаточная документация по настройке Keycloak

**Проблема:** В `DEPLOYMENT.md` описана только базовая настройка клиента.

**Рекомендация:**
1. Добавить скриншоты или диаграммы настройки Keycloak
2. Описать настройку маппинга групп и ролей
3. Добавить процедуру тестирования SSO
4. Указать, как обрабатывать logout и сессию

---

### 3.4. Скрипт restore.sh имеет проблемы

**Проблема 1:** Использование `localhost` в `curl`:
```bash
curl -X DELETE "http://localhost:9200/zammad_*"
```

Это не сработает, если скрипт запускается не на хосте Docker.

**Рекомендация:**
```bash
docker compose exec elasticsearch curl -X DELETE "http://localhost:9200/zammad_*"
```

**Проблема 2:** Нет проверки успешности операций восстановления.

**Рекомендация:** Добавить проверки после каждого этапа:
```bash
if ! cat "$BACKUP_DIR/zammad_db.sql" | docker compose exec -T postgres psql -U zammad zammad; then
    echo "[!] Ошибка восстановления PostgreSQL"
    exit 1
fi
```

---

### 3.5. prepare-backup.sh не восстанавливает worker при ошибке

**Проблема:** Если скрипт падает после остановки worker, он не будет перезапущен.

**Рекомендация:** Использовать trap:
```bash
trap 'docker compose start zammad-worker' EXIT ERR
```

---

### 3.6. Отсутствие тестов конфигурации

**Проблема:** Нет автоматической проверки валидности `docker-compose.yml` и `service.yml`.

**Рекомендация:**
1. Добавить скрипт `scripts/validate.sh`:
```bash
#!/bin/bash
docker compose config --quiet && echo "docker-compose.yml валиден"
yamllint service.yml && echo "service.yml валиден"
```

2. Интегрировать в CI/CD pipeline

---

## 4. Рекомендации по улучшению

### 4.1. Добавить зависимости между сервисами в backup

**Проблема:** В `service.yml` backup настроен, но нет явной зависимости от `_core/backup`.

**Рекомендация:**
```yaml
dependencies:
  external:
    - keycloak
    - mail
  platform:
    - backup
    - monitoring
```

---

### 4.2. Добавить процедуру декомиссии сервиса

**Проблема:** Нет документации по удалению/архивированию сервиса.

**Рекомендация:** Добавить в `MAINTENANCE.md`:
```bash
# Остановить сервис
ops down support

# Сохранить финальный бэкап
./scripts/prepare-backup.sh

# Удалить контейнеры и volumes
docker compose down -v

# Архивировать данные
tar -czf support_archive_$(date +%Y%m%d).tar.gz data/ logs/

# Удалить из конфигурации платформы
rm service.yml
```

---

### 4.3. Добавить документацию по масштабированию

**Проблема:** В `ARCHITECTURE.md` упомянута возможность масштабирования, но нет практических инструкций.

**Рекомендация:** Добавить раздел в `DEPLOYMENT.md`:
```yaml
# Горизонтальное масштабирование web
docker compose up -d --scale zammad-web=3

# Ограничения:
# - Redis должен выдерживать нагрузку
# - PostgreSQL может стать узким местом
# - Elasticsearch требует отдельного шардирования
```

---

### 4.4. Улучшить мониторинг

**Проблема:** В `MAINTENANCE.md` метрики Prometheus перечислены, но нет готовых алертов.

**Рекомендация:**
1. Создать файл `config/prometheus/alerts.yml` с готовыми правилами
2. Добавить дашборд Grafana в `docs/grafana-dashboard.json`
3. Включить экспорт метрик Zammad (требуется дополнительный exporter)

---

### 4.5. Добавить проверку совместимости версий

**Проблема:** Нет механизма проверки совместимости версий компонентов.

**Рекомендация:** Добавить в `scripts/init.sh`:
```bash
# Проверка версий
REQUIRED_DOCKER="24.0"
INSTALLED_DOCKER=$(docker --version | grep -oP '\d+\.\d+')

if ! version_gt "$INSTALLED_DOCKER" "$REQUIRED_DOCKER"; then
    echo "[!] Требуется Docker >= $REQUIRED_DOCKER"
    exit 1
fi
```

---

### 4.6. Улучшить обработку ошибок в init-secrets.sh

**Проблема:** Скрипт молча заменяет значения, нет проверки успешности.

**Рекомендация:**
```bash
replace_if_changeme() {
    local key=$1
    local value=$2

    if grep -q "${key}=changeme" "$ENV_FILE"; then
        echo "[*] Генерация $key..."
        if ! sed -i "s/${key}=.*/${key}=${value}/" "$ENV_FILE"; then
            echo "[!] Ошибка обновления $key"
            return 1
        fi
        echo "[✓] $key сгенерирован"
    else
        echo "[✓] $key уже установлен"
    fi
}
```

---

## 5. Мелкие замечания

### 5.1. Несогласованность в названиях

| Документ | Название |
|----------|----------|
| `service.yml` | `support` |
| `docker-compose.yml` | `support-zammad-*` |
| Документация | "Support", "Zammad" |

**Рекомендация:** Унифицировать naming convention в README.md

---

### 5.2. Избыточность в docker-compose.yml

**Проблема:** Переменные окружения дублируются для web и worker.

**Рекомендация:** Использовать `extends` или `x-` anchors:
```yaml
x-zammad-env: &zammad-env
  RAILS_ENV: production
  DATABASE_URL: ...

services:
  zammad-web:
    environment: *zammad-env
  
  zammad-worker:
    environment: *zammad-env
```

---

### 5.3. Отсутствие .dockerignore

**Проблема:** Нет файла `.dockerignore` для оптимизации сборки образов.

**Рекомендация:** Создать `.dockerignore`:
```
.git
.gitignore
docs/
*.md
.env
.env.example
```

---

### 5.4. Недостаточная документация по логам

**Проблема:** В `docker-compose.yml` логи мапятся на volume, но нет ротации.

**Рекомендация:**
```yaml
logging:
  driver: "local"
  options:
    max-size: "100m"
    max-file: "3"
```

---

### 5.5. Missing переменные в .env.example

**Проблема:** Некоторые переменные, используемые в `docker-compose.yml`, отсутствуют в `.env.example`:
- `LOG_LEVEL` (есть по умолчанию, но не документирован)
- `SERVICE_NAME`, `SERVICE_VERSION` (не используются)

**Рекомендация:** Удалить неиспользуемые переменные или добавить их использование.

---

## 6. Вопросы безопасности

### 6.1. Elasticsearch без аутентификации

**Проблема:**
```yaml
xpack.security.enabled=false
```

**Рекомендация:**
1. Включить security в production
2. Добавить базовую аутентификацию
3. Ограничить доступ к порту 9200 только для внутренних сервисов

---

### 6.2. Отсутствие Content Security Policy

**Проблема:** Нет заголовков безопасности в конфигурации.

**Рекомендация:** Добавить в Caddy или zammad-web:
```
Header set Content-Security-Policy "default-src 'self'; ..."
Header set X-Frame-Options "DENY"
Header set X-Content-Type-Options "nosniff"
```

---

### 6.3. Сессии Keycloak

**Проблема:** Не описана политика сессий и токенов.

**Рекомендация:**
1. Указать TTL access token и refresh token
2. Настроить logout session validity
3. Добавить процедуру отзыва токенов

---

## 7. Положительные моменты

✅ **Отличная структура документации** — все необходимые файлы присутствуют  
✅ **Детальный план реализации** — разбит на этапы с критериями готовности  
✅ **Health checks для всех сервисов** — правильный подход к отказоустойчивости  
✅ **Интеграция с платформой** — бэкапы, мониторинг, логирование  
✅ **Скрипты автоматизации** — init, backup, restore  
✅ **Модель данных документирована** — схема БД и индексы ES  
✅ **Диаграммы последовательности** — наглядное описание процессов  

---

## 8. Приоритеты исправлений

### Критические (до запуска)
1. Исправить расчёт памяти Elasticsearch
2. Добавить процедуру обновления версий
3. Защитить `.env` от попадания в git

### Высокие (перед production)
4. Улучшить health check worker
5. Исправить `restore.sh`
6. Добавить rate limiting
7. Включить security в Elasticsearch

### Средние (после запуска)
8. Добавить алерты Prometheus
9. Создать дашборд Grafana
10. Добавить документацию по масштабированию

### Низкие (опционально)
11. Унифицировать naming
12. Добавить `.dockerignore`
13. Оптимизировать `docker-compose.yml`

---

## 9. Выводы

Проект готов к реализации на **75-80%**. Основная архитектура продумана хорошо, но требуется доработка в областях:

1. **Управление ресурсами** — критическая проблема с памятью
2. **Безопасность** — требуется усиление защиты данных
3. **Операционные процедуры** — обновление, восстановление, масштабирование
4. **Автоматизация** — валидация, тестирование, CI/CD

**Рекомендация:** Начать с исправления критических замечаний, затем перейти к высоким приоритетам перед production запуском.
