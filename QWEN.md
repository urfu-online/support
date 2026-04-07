# Support Service — Контекст проекта

## 📋 Обзор проекта

**Сервис технической поддержки** на базе **Zammad 7.x** — open-source системы управления заявками (helpdesk/ITSM) для организации приёма и обработки обращений пользователей.

### Основное назначение
- Приём и обработка обращений через веб-интерфейс, email, телефон
- Мультиканальность: email, веб-форма, телефония (опционально)
- База знаний для самообслуживания пользователей
- Система отчётов и аналитики
- SLA-менеджмент

### Публичные домены
- **Основной**: `help.openedu.urfu.ru`
- **Резервный**: `help.urfu.online`

---

## 🏗️ Архитектура

### Компоненты (Docker Compose)

| Сервис | Образ | Назначение | Ресурсы (CPU/RAM) |
|--------|-------|------------|-------------------|
| `zammad-web` | `zammad/zammad:7` | Веб-интерфейс + REST API + WebSocket | 1.0 / 2Gi |
| `zammad-worker` | `zammad/zammad:7` | Фоновые задачи (email, уведомления, отчёты) | 0.5 / 1Gi |
| `postgres` | `postgres:15-alpine` | Основное хранилище данных | 0.5 / 1Gi |
| `redis` | `redis:7-alpine` | Кэш, очереди, real-time уведомления | 0.25 / 512Mi |
| `elasticsearch` | `elasticsearch:8.11.0` | Полнотекстовый поиск, отчёты | 1.0 / 2Gi |

**Итого**: 3.25 CPU / 6.5Gi RAM

> **Примечание:** Heap Elasticsearch уменьшен до 1.5Gi (1536m) для укладывания в общий лимит 6Gi.
> Окружение сервисов Zammad вынесено в `x-zammad-common` (DRY принцип).
> Добавлена ротация логов для всех контейнеров.

### Схема архитектуры

```
┌─────────────────────────────────────────────────────────────┐
│                    Platform Caddy Proxy                     │
│              (маршрутизация с help.openedu.urfu.ru)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Zammad Application                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Web UI    │  │   REST API  │  │  WebSocket Server   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│  PostgreSQL │ │    Redis    │ │ Elasticsearch   │
│   (данные)  │ │  (кэш/очереди)│ │   (поиск)      │
└─────────────┘ └─────────────┘ └─────────────────┘
```

### Внешние интеграции
- **Keycloak**: `openedu.urfu.ru/auth/realms/urfu` — SSO аутентификация (OIDC)
- **Почта**: IMAP/SMTP через `mail.openedu.urfu.ru` / `smtp.openedu.urfu.ru`
- **Платформа**: Caddy proxy, Loki (логи), Prometheus (метрики), Restic (бэкапы)

---

## 📁 Структура проекта

```
services/public/support/
├── docker-compose.yml          # Оркестрация контейнеров
├── service.yml                 # Конфигурация платформы
├── .env.example                # Шаблон переменных окружения
├── .dockerignore               # Исключения для Docker
├── .env                        # Переменные окружения (игнорируется)
├── README.md                   # Основная документация
├── QWEN.md                     # Этот файл — контекст для AI
├── docs/                       # Подробная документация
│   ├── ARCHITECTURE.md         # Детальная архитектура
│   ├── IMPLEMENTATION_PLAN.md  # План реализации по этапам
│   ├── DEPLOYMENT.md           # Руководство по развёртыванию
│   └── MAINTENANCE.md          # Обслуживание и мониторинг
├── config/                     # Конфигурация компонентов
│   └── elasticsearch/
│       └── jvm.options         # Настройки памяти ES (-Xms1536m -Xmx1536m)
├── scripts/                    # Скрипты обслуживания
│   ├── init-secrets.sh         # Генерация безопасных секретов
│   ├── init.sh                 # Инициализация сервиса
│   ├── prepare-backup.sh       # Подготовка к бэкапу
│   ├── restore.sh              # Восстановление из бэкапа
│   └── validate.sh             # Валидация конфигурации
├── data/                       # Постоянные данные (volume)
│   ├── postgres/
│   ├── redis/
│   ├── elasticsearch/
│   └── zammad/
├── logs/                       # Логи сервиса
└── config/                     # Конфигурация
```

---

## 🚀 Запуск и управление

### Требования
- Docker ≥ 24.0
- Docker Compose Plugin
- Платформенная сеть `platform_network`
- Внешний Keycloak: `openedu.urfu.ru/auth/`

### Команды управления

```bash
# Инициализация (первый запуск)
cd /apps/services/public/support
cp .env.example .env
./scripts/init-secrets.sh

# Запуск сервиса
ops up support

# Проверка статуса
ops list

# Просмотр логов
ops logs support
ops logs support -f  # в реальном времени

# Остановка
ops down support

# Перезагрузка
ops restart support

# Health check
curl -f http://localhost:3000/api/v1/status
```

### Docker Compose команды (альтернатива)

```bash
docker compose up -d           # Запуск в фоне
docker compose down            # Остановка
docker compose ps              # Статус контейнеров
docker compose logs -f         # Логи
docker compose restart         # Перезагрузка
docker compose config          # Проверка конфигурации
```

---

## 🔧 Конфигурация

### Переменные окружения (.env)

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `ZAMMAD_RAILS_SECRET` | Секрет для Rails | (генерируется) |
| `ZAMMAD_SESSION_SECRET` | Секрет сессий | (генерируется) |
| `POSTGRES_USER` | Пользователь PostgreSQL | `zammad` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | (генерируется) |
| `POSTGRES_DB` | Имя базы данных | `zammad` |
| `REDIS_URL` | URL Redis | `redis://redis:6379` |
| `ES_URL` | URL Elasticsearch | `http://elasticsearch:9200` |
| `KEYCLOAK_URL` | URL Keycloak | `https://openedu.urfu.ru/auth` |
| `KEYCLOAK_REALM` | Realm Keycloak | `urfu` |
| `KEYCLOAK_CLIENT_ID` | Client ID Keycloak | `zammad-help` |
| `KEYCLOAK_CLIENT_SECRET` | Client Secret | (из Keycloak) |
| `EMAIL_IMAP_*` | Настройки входящей почты | — |
| `EMAIL_SMTP_*` | Настройки исходящей почты | — |
| `LOG_LEVEL` | Уровень логирования | `info` |

### Health Check

- **Endpoint**: `/api/v1/status`
- **Interval**: 30s
- **Timeout**: 10s
- **Retries**: 3

### Бэкапы

- **Расписание**: ежедневно в 02:00 (`0 2 * * *`)
- **Хранение**: 7 дней
- **Компоненты**: PostgreSQL, Elasticsearch, файлы Zammad
- **Инструмент**: Restic (через `_core/backup`)

---

## 🧪 Разработка и тестирование

### Проверка работоспособности компонентов

```bash
# PostgreSQL
docker compose exec postgres pg_isready -U zammad -d zammad

# Redis
docker compose exec redis redis-cli ping

# Elasticsearch
curl -f http://localhost:9200/_cluster/health

# Zammad
curl -f http://localhost:3000/api/v1/status
```

### Тестовые сценарии

1. **Создание заявки через веб-форму**: Открыть `https://help.openedu.urfu.ru` → "Создать заявку"
2. **Создание заявки через email**: Отправить письмо на `support@openedu.urfu.ru`
3. **SSO аутентификация**: Войти через Keycloak

---

## 📊 Мониторинг

### Метрики Prometheus
- **Port**: 3000
- **Path**: `/metrics`
- **Labels**: `service=support`

### Логи
- **Driver**: `loki`
- **Labels**: `service=support`, `component=*`

### Ключевые метрики
- `zammad_tickets_total` — общее количество заявок
- `zammad_tickets_open` — открытые заявки
- `zammad_response_time_seconds` — среднее время ответа
- `up{service="support"}` — доступность сервиса

---

## 🔗 Ссылки на документацию

| Документ | Описание |
|----------|----------|
| [README.md](./README.md) | Быстрый старт и обзор |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Детальная архитектура и модель данных |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Пошаговое руководство по развёртыванию |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) | План реализации по этапам (8 недель) |
| [docs/MAINTENANCE.md](./docs/MAINTENANCE.md) | Обслуживание и мониторинг |

---

## ⚠️ Важные замечания

### Elasticsearch Heap
Heap size не должен превышать 50% доступной RAM и не более 32 ГБ (compressed oops).
Текущая настройка: `-Xms1536m -Xmx1536m` (файл `config/elasticsearch/jvm.options`)
Уменьшено с 2g до 1.5g для укладывания в общий лимит 6Gi.

### Сетевая безопасность
- Все сервисы изолированы в `platform_network`
- Доступ извне только через Caddy (порт 80/443)
- Внутренние порты не опубликованы наружу

### Секреты
- Файл `.env` игнорируется в git (`.gitignore`)
- Используйте `./scripts/init-secrets.sh` для генерации безопасных значений
- Ручная настройка требуется для: `EMAIL_*_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`

### Масштабирование
- Горизонтальное: возможно для `zammad-web` (replicas) и `zammad-worker`
- Вертикальное: рекомендуется 8 ГБ RAM / 4 CPU для production

---

## 🆘 Поддержка и контакты

- **Техническая поддержка**: `support@urfu.ru`
- **Maintainer**: `support@openedu.urfu.ru`
- **Репозиторий**: `https://github.com/urfu/apps-service-opus/tree/main/services/public/support`
- **Мониторинг**: `https://grafana.openedu.urfu.ru`
- **Документация внутри сервиса**: `https://help.openedu.urfu.ru/help`
