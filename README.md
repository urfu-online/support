# Сервис технической поддержки (Support)

Сервис технической поддержки пользователей на основе **Zammad** — open-source системы управления заявками (helpdesk).

## 📋 Описание

Сервис предоставляет:
- Приём и обработку обращений пользователей через веб-интерфейс
- Мультиканальность: email, веб-форма, телефония (опционально)
- Базу знаний для самообслуживания пользователей
- Систему отчётов и аналитики
- Интеграцию с внешней системой аутентификации (Keycloak)

### Публичные домены

- **Основной**: `help.openedu.urfu.ru`
- **Резервный**: `help.urfu.online` (обратная совместимость)

## 🏗️ Архитектура

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

## 📚 Документация

| Документ | Описание |
|----------|----------|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Подробная архитектура сервиса |
| [IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) | План реализации по этапам |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Руководство по развёртыванию |
| [MAINTENANCE.md](./docs/MAINTENANCE.md) | Обслуживание и мониторинг |

## 🚀 Быстрый старт

### Требования

- Docker ≥ 24.0
- Docker Compose Plugin
- Платформенная сеть `platform_network`
- Внешний Keycloak: `openedu.urfu.ru/auth/`

### Запуск сервиса

```bash
# Клонировать репозиторий (если ещё не клонирован)
cd /apps/services/public/support

# Скопировать переменные окружения
cp .env.example .env

# Запустить сервис
ops up support

# Проверить статус
ops list
```

### Проверка доступности

```bash
# Логи сервиса
ops logs support

# Health check
curl -f http://localhost:3000/api/v1/status
```

## 📁 Структура проекта

```
services/public/support/
├── docker-compose.yml          # Оркестрация контейнеров
├── service.yml                 # Конфигурация платформы
├── .env.example                # Шаблон переменных окружения
├── .dockerignore               # Исключения для Docker
├── README.md                   # Этот файл
├── docs/                       # Документация
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── DEPLOYMENT.md
│   └── MAINTENANCE.md
├── config/                     # Конфигурация
│   └── elasticsearch/
│       └── jvm.options         # Настройки памяти ES (1.5Gi heap)
├── scripts/                    # Скрипты обслуживания
│   ├── init.sh                 # Инициализация
│   ├── init-secrets.sh         # Генерация секретов
│   ├── prepare-backup.sh       # Подготовка к бэкапу
│   ├── restore.sh              # Восстановление
│   └── validate.sh             # Валидация конфигурации
├── data/                       # Постоянные данные (volume)
│   ├── postgres/
│   ├── redis/
│   ├── elasticsearch/
│   └── zammad/
└── logs/                       # Логи (ротация: 100МБ/3 файла)
```

## 🔧 Конфигурация

### Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `ZAMMAD_RAILS_SECRET` | Секрет для Rails | (генерируется) |
| `POSTGRES_USER` | Пользователь PostgreSQL | `zammad` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | (генерируется) |
| `POSTGRES_DB` | Имя базы данных | `zammad` |
| `REDIS_URL` | URL Redis | `redis://redis:6379` |
| `ES_URL` | URL Elasticsearch | `http://elasticsearch:9200` |
| `KEYCLOAK_URL` | URL Keycloak | `https://openedu.urfu.ru/auth` |

### Ресурсы

| Компонент | CPU | RAM | Примечание |
|-----------|-----|-----|------------|
| Zammad Web | 1.0 | 2 ГБ | |
| Zammad Worker | 0.5 | 1 ГБ | |
| PostgreSQL | 0.5 | 1 ГБ | |
| Redis | 0.25 | 512 МБ | maxmemory: 256 МБ |
| Elasticsearch | 1.0 | 2 ГБ | heap: 1.5 ГБ |
| **Итого** | **3.25** | **6.5 ГБ** | ES heap оптимизирован |

## 🔗 Интеграции

### Аутентификация

Внешний Keycloak: `openedu.urfu.ru/auth/realms/urfu`

### Маршрутизация

Платформенная Caddy автоматически создаёт маршрут на основе `service.yml`:
- `help.openedu.urfu.ru` → `zammad-web:80`
- `help.urfu.online` → `zammad-web:80`

### Бэкапы

Интеграция с платформенным сервисом бэкапов (`_core/backup`):
- Ежедневный бэкап в 02:00
- Хранение: 7 дней
- Бэкапируемые данные: PostgreSQL, Elasticsearch, файлы Zammad

## 📊 Мониторинг

### Health Check

- Endpoint: `/api/v1/status`
- Interval: 30s
- Timeout: 10s
- Retries: 3

### Метрики Prometheus

- Port: 80
- Path: `/metrics`

### Логи

- Driver: `loki`
- Labels: `service=support`, `component=*`
- Ротация: 100 МБ / 3 файла

## 🆘 Поддержка

- **Документация**: `/help` (внутри сервиса)
- **Админ-панель**: `/admin` (требует прав администратора)
- **Технический контакт**: см. `service.yml`
