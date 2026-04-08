# План реализации сервиса Support

## Общая информация

**Проект:** Сервис технической поддержки на базе Zammad
**Срок реализации:** 6-8 недель
**Сложность:** Средняя (интеграция готового решения)

---

## Этап 1: Подготовка инфраструктуры (1-2 недели)

### Неделя 1: Настройка проекта

#### День 1-2: Инициализация проекта

**Задачи:**
- [ ] Создать структуру директорий сервиса
- [ ] Инициализировать Git-репозиторий
- [ ] Создать базовые файлы проекта (`.gitignore`, `README.md`)
- [ ] Создать шаблон `service.yml` для платформы

**Структура:**
```
services/public/support/
├── .gitignore
├── README.md
├── service.yml
├── docker-compose.yml
├── .env.example
├── docs/
├── config/
├── scripts/
├── data/
└── logs/
```

**Критерии готовности:**
- [ ] Репозиторий инициализирован
- [ ] Структура создана
- [ ] `service.yml` валиден

---

#### День 3-4: Docker Compose конфигурация

**Задачи:**
- [ ] Создать `docker-compose.yml` с сервисами:
  - `zammad-web`
  - `zammad-worker`
  - `postgres`
  - `redis`
  - `elasticsearch`
- [ ] Настроить network (`platform_network`)
- [ ] Настроить volumes для постоянных данных
- [ ] Добавить health checks для всех сервисов

**Пример конфигурации:**
```yaml
version: '3.8'

services:
  zammad-web:
    image: zammad/zammad:7
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      elasticsearch:
        condition: service_healthy
    environment:
      - RAILS_ENV=production
      - DATABASE_URL=postgresql://zammad:password@postgres:5432/zammad
      - REDIS_URL=redis://redis:6379
      - ES_URL=http://elasticsearch:9200
    volumes:
      - zammad_data:/opt/zammad
    networks:
      - platform
    labels:
      - "platform.service=support"
      - "prometheus.scrape=true"
      - "prometheus.port=80"

  zammad-worker:
    image: zammad/zammad:7
    command: zammad-worker
    depends_on:
      - zammad-web
    environment:
      # Те же переменные
    networks:
      - platform

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_USER=zammad
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=zammad
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - platform
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zammad"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - platform
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
      - ./config/elasticsearch/jvm.options:/usr/share/elasticsearch/config/jvm.options:ro
    networks:
      - platform
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health"]
      interval: 30s
      timeout: 10s
      retries: 5

volumes:
  zammad_data:
  postgres_data:
  redis_data:
  elasticsearch_data:

networks:
  platform:
    external: true
    name: platform_network
```

**Критерии готовности:**
- [ ] Все сервисы описаны
- [ ] Health checks настроены
- [ ] Volumes определены

---

#### День 5: Конфигурация переменных окружения

**Задачи:**
- [ ] Создать `.env.example` с шаблоном переменных
- [ ] Создать скрипт генерации секретов
- [ ] Документировать все переменные

**Файл `.env.example`:**
```bash
# Zammad
ZAMMAD_RAILS_SECRET=changeme_generate_random_32_chars
ZAMMAD_SESSION_SECRET=changeme_generate_random_32_chars

# PostgreSQL
POSTGRES_USER=zammad
POSTGRES_PASSWORD=changeme_generate_secure_password
POSTGRES_DB=zammad

# Redis
REDIS_URL=redis://redis:6379

# Elasticsearch
ES_URL=http://elasticsearch:9200

# Keycloak (внешний)
KEYCLOAK_URL=https://openedu.urfu.ru/auth
KEYCLOAK_REALM=master
KEYCLOAK_CLIENT_ID=zammad-help

# Email (входящий)
EMAIL_IMAP_SERVER=mail.openedu.urfu.ru
EMAIL_IMAP_PORT=993
EMAIL_IMAP_USER=support@openedu.urfu.ru
EMAIL_IMAP_PASSWORD=changeme

# Email (исходящий)
EMAIL_SMTP_SERVER=smtp.openedu.urfu.ru
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=support@openedu.urfu.ru
EMAIL_SMTP_PASSWORD=changeme
```

**Скрипт `scripts/init-secrets.sh`:**
```bash
#!/bin/bash
# Генерация безопасных секретов

generate_secret() {
    openssl rand -hex 16
}

if [ ! -f .env ]; then
    cp .env.example .env
    
    sed -i "s/ZAMMAD_RAILS_SECRET=.*/ZAMMAD_RAILS_SECRET=$(generate_secret)/" .env
    sed -i "s/ZAMMAD_SESSION_SECRET=.*/ZAMMAD_SESSION_SECRET=$(generate_secret)/" .env
    sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -base64 24)/" .env
    
    echo "Secrets generated successfully!"
else
    echo ".env already exists. Remove it first to regenerate."
fi
```

**Критерии готовности:**
- [ ] `.env.example` создан
- [ ] Скрипт генерации работает
- [ ] Документация обновлена

---

### Неделя 2: Интеграция с платформой

#### День 1-2: Настройка service.yml

**Задачи:**
- [ ] Заполнить `service.yml` согласно шаблону платформы
- [ ] Настроить маршрутизацию для двух доменов
- [ ] Настроить health check
- [ ] Настроить ресурсы

**Файл `service.yml`:**
```yaml
name: support
display_name: "Техническая поддержка"
version: "1.0.0"
description: "Сервис технической поддержки пользователей на базе Zammad"
maintainer: "support@openedu.urfu.ru"
repository: "https://github.com/MasterGowen/support"
tags:
  - helpdesk
  - production

type: docker-compose
visibility: public

routing:
  - type: domain
    domain: help.openedu.urfu.ru
    internal_port: 80
  - type: domain
    domain: help.urfu.online
    internal_port: 80

health:
  enabled: true
  endpoint: /api/v1/status
  interval: 30s
  timeout: 10s
  retries: 3

resources:
  memory_limit: 6Gi
  cpu_limit: 3.0

backup:
  enabled: true
  schedule: "0 2 * * *"
  retention: 7
  paths:
    - ./data/zammad
  databases:
    - type: postgres
      container: postgres
      database: zammad
    - type: elasticsearch
      container: elasticsearch
      indices:
        - zammad_*

logging:
  driver: loki
  labels:
    - service=support

dependencies:
  external:
    - keycloak
    - mail

environment:
  RAILS_ENV: production
  LOG_LEVEL: info

hooks:
  post_deploy:
    - "./scripts/init.sh"
  pre_backup:
    - "./scripts/prepare-backup.sh"

notifications:
  telegram: true
  events:
    - deploy
    - error
    - health_fail
```

**Критерии готовности:**
- [ ] `service.yml` валиден
- [ ] Маршрутизация настроена
- [ ] Бэкапы сконфигурированы

---

#### День 3-4: Интеграция аутентификации (Keycloak)

**Задачи:**
- [ ] Зарегистрировать клиент в Keycloak
- [ ] Настроить OIDC провайдер в Zammad
- [ ] Протестировать SSO вход

**Конфигурация Keycloak:**
1. Создать клиент `zammad-help`:
   - Client protocol: `openid-connect`
   - Access type: `confidential`
   - Valid redirect URIs: `https://help.openedu.urfu.ru/auth/callback`
   - Valid post logout redirect URIs: `https://help.openedu.urfu.ru`

2. Получить credentials:
   - Client ID: `zammad-help`
   - Client Secret: (из Keycloak)

**Настройка Zammad (через API после деплоя):**
```bash
# Создание OIDC провайдера
curl -X POST https://help.openedu.urfu.ru/api/v1/channels_oidc \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Keycloak URFU",
    "issuer": "https://openedu.urfu.ru/auth/realms/master",
    "client_id": "zammad-help",
    "client_secret": "<secret>",
    "scope": "openid email profile",
    "active": true
  }'
```

**Критерии готовности:**
- [ ] Клиент создан в Keycloak
- [ ] OIDC настроен в Zammad
- [ ] SSO вход работает

---

#### День 5: Тестирование интеграции

**Задачи:**
- [ ] Запустить сервис через `ops up support`
- [ ] Проверить доступность по доменам
- [ ] Проверить health endpoint
- [ ] Проверить логи в Loki

**Чеклист:**
- [ ] `ops list` показывает сервис
- [ ] `ops logs support` показывает логи
- [ ] HTTPS работает (сертификат Let's Encrypt)
- [ ] Health check проходит

---

## Этап 2: Настройка Zammad (2-3 недели)

### Неделя 3: Базовая конфигурация Zammad

#### День 1-2: Первичная инициализация

**Задачи:**
- [ ] Выполнить начальную настройку Zammad
- [ ] Создать администратора
- [ ] Настроить системные параметры
- [ ] Настроить логотип и брендинг

**Шаги:**
1. Открыть `https://help.openedu.urfu.ru`
2. Пройти мастер начальной настройки
3. Создать учётную запись администратора
4. Настроить базовые параметры системы

**Критерии готовности:**
- [ ] Администратор создан
- [ ] Система инициализирована
- [ ] Брендинг настроен

---

#### День 3-4: Настройка групп и ролей

**Задачи:**
- [ ] Создать группы для заявок
- [ ] Настроить роли пользователей
- [ ] Настроить права доступа

**Структура групп:**
```
- Support (основная)
  - Level 1 (первичная поддержка)
  - Level 2 (техническая поддержка)
  - Level 3 (разработчики)
- Billing (биллинг и оплаты)
- Administration (административные вопросы)
```

**Роли:**
- **Admin**: полный доступ
- **Agent**: обработка заявок в своих группах
- **Customer**: создание заявок

**Критерии готовности:**
- [ ] Группы созданы
- [ ] Роли настроены
- [ ] Права назначены

---

#### День 5: Настройка email-каналов

**Задачи:**
- [ ] Настроить входящий email (IMAP)
- [ ] Настроить исходящий email (SMTP)
- [ ] Протестировать отправку/получение

**Конфигурация:**
```
Входящий (IMAP):
- Server: mail.openedu.urfu.ru:993 (SSL)
- Mailbox: support@openedu.urfu.ru
- Group: Support

Исходящий (SMTP):
- Server: smtp.openedu.urfu.ru:587 (STARTTLS)
- From: support@openedu.urfu.ru
```

**Критерии готовности:**
- [ ] Email получаются
- [ ] Email отправляются
- [ ] Тикеты создаются из писем

---

### Неделя 4: Настройка процессов

#### День 1-2: Overviews (представления)

**Задачи:**
- [ ] Создать представления для агентов
- [ ] Настроить фильтры и сортировки
- [ ] Настроить виджеты дашборда

**Примеры overviews:**
- "Мои открытые заявки"
- "Неназначенные заявки"
- "Заявки в ожидании"
- "Просроченные заявки"
- "Закрытые за сегодня"

**Критерии готовности:**
- [ ] Overviews созданы
- [ ] Фильтры работают
- [ ] Дашборд настроен

---

#### День 3-4: Triggers и автоматизация

**Задачи:**
- [ ] Настроить триггеры для автоматизации
- [ ] Настроить уведомления
- [ ] Настроить SLA (опционально)

**Примеры triggers:**
- Автоназначение на группу при создании
- Уведомление при смене статуса
- Эскалация при просрочке
- Автозакрытие при отсутствии ответа

**Критерии готовности:**
- [ ] Триггеры работают
- [ ] Уведомления приходят
- [ ] Автоматизация настроена

---

#### День 5: База знаний

**Задачи:**
- [ ] Включить модуль базы знаний
- [ ] Создать структуру категорий
- [ ] Добавить первые статьи

**Структура:**
```
- Общие вопросы
  - Как создать заявку
  - Как отследить статус
  - Частые вопросы (FAQ)
- Технические вопросы
  - Настройка доступа
  - Интеграции
  - API документация
```

**Критерии готовности:**
- [ ] База знаний доступна
- [ ] Категории созданы
- [ ] Статьи опубликованы

---

### Неделя 5: Интеграции и кастомизация

#### День 1-2: Кастомизация полей

**Задачи:**
- [ ] Создать кастомные поля для заявок
- [ ] Настроить валидацию
- [ ] Настроить видимость полей

**Примеры полей:**
- "Тип обращения" (выпадающий список)
- "Критичность" (селект)
- "Связанная система" (селект)
- "Контактный телефон" (текст)

**Критерии готовности:**
- [ ] Поля созданы
- [ ] Валидация работает
- [ ] Формы обновлены

---

#### День 3-4: Отчёты и аналитика

**Задачи:**
- [ ] Настроить стандартные отчёты
- [ ] Создать кастомные дашборды
- [ ] Настроить экспорт данных

**Отчёты:**
- Количество заявок по дням
- Среднее время ответа
- Распределение по группам
- Топ агентов
- Удовлетворённость (CSAT)

**Критерии готовности:**
- [ ] Отчёты доступны
- [ ] Данные корректны
- [ ] Экспорт работает

---

#### День 5: Тестирование функциональности

**Задачи:**
- [ ] Протестировать полный цикл заявки
- [ ] Проверить все каналы связи
- [ ] Проверить уведомления

**Сценарии:**
- [ ] Создание заявки через веб-форму
- [ ] Создание заявки через email
- [ ] Назначение и обработка
- [ ] Комментирование
- [ ] Закрытие заявки
- [ ] Оценка качества (CSAT)

---

## Этап 3: Промышленная подготовка (1-2 недели)

### Неделя 6: Бэкапы и восстановление

#### День 1-2: Настройка бэкапов

**Задачи:**
- [ ] Интегрировать с `_core/backup`
- [ ] Настроить расписание
- [ ] Настроить хранение

**Конфигурация:**
```yaml
# В service.yml
backup:
  enabled: true
  schedule: "0 2 * * *"
  retention: 7
```

**Скрипт `scripts/prepare-backup.sh`:**
```bash
#!/bin/bash
# Подготовка к бэкапу

# Остановить worker для консистентности
docker compose stop zammad-worker

# Создать дамп PostgreSQL
docker compose exec postgres pg_dump -U zammad zammad > /tmp/zammad_db.sql

# Синхронизировать файлы
rsync -a /data/zammad/ /backup/zammad_files/

# Запустить worker
docker compose start zammad-worker
```

**Критерии готовности:**
- [ ] Бэкапы создаются
- [ ] Расписание работает
- [ ] Логи бэкапов доступны

---

#### День 3-4: Тестирование восстановления

**Задачи:**
- [ ] Протестировать восстановление БД
- [ ] Протестировать восстановление файлов
- [ ] Документировать процедуру

**Скрипт `scripts/restore.sh`:**
```bash
#!/bin/bash
# Восстановление из бэкапа

BACKUP_DATE=$1

if [ -z "$BACKUP_DATE" ]; then
    echo "Usage: $0 <backup_date>"
    exit 1
fi

# Восстановление PostgreSQL
docker compose exec -T postgres psql -U zammad zammad < backups/$BACKUP_DATE/zammad_db.sql

# Восстановление файлов
rsync -a backups/$BACKUP_DATE/zammad_files/ /data/zammad/

# Перезапуск
docker compose restart

echo "Restore completed!"
```

**Критерии готовности:**
- [ ] Восстановление работает
- [ ] Данные целостны
- [ ] Инструкция задокументирована

---

#### День 5: Мониторинг и алерты

**Задачи:**
- [ ] Настроить метрики Prometheus
- [ ] Настроить дашборд Grafana
- [ ] Настроить алерты

**Метрики:**
- `zammad_tickets_total`
- `zammad_tickets_open`
- `zammad_response_time_seconds`
- `zammad_database_connections`

**Алерты:**
- Сервис недоступен
- Высокая загрузка CPU/RAM
- Много открытых заявок
- Бэкап не выполнен

**Критерии готовности:**
- [ ] Метрики собираются
- [ ] Дашборд создан
- [ ] Алерты работают

---

### Неделя 7: Документирование и обучение

#### День 1-2: Документация для пользователей

**Задачи:**
- [ ] Создать руководство пользователя
- [ ] Создать FAQ
- [ ] Записать скринкасты (опционально)

**Содержание:**
- Как создать заявку
- Как отследить статус
- Как прикрепить файлы
- Как оценить качество

**Критерии готовности:**
- [ ] Документация опубликована
- [ ] FAQ доступен
- [ ] Ссылки работают

---

#### День 3-4: Документация для администраторов

**Задачи:**
- [ ] Создать руководство администратора
- [ ] Документировать процедуры
- [ ] Создать runbook

**Содержание:**
- Управление пользователями
- Настройка групп и ролей
- Создание overviews
- Настройка триггеров
- Мониторинг и логи

**Критерии готовности:**
- [ ] Runbook создан
- [ ] Процедуры описаны
- [ ] Контакты указаны

---

#### День 5: Обучение команды

**Задачи:**
- [ ] Провести тренинг для агентов
- [ ] Создать тестовые сценарии
- [ ] Собрать обратную связь

**Программа:**
- Обзор интерфейса
- Обработка заявок
- Использование базы знаний
- Отчёты и аналитика

**Критерии готовности:**
- [ ] Обучение проведено
- [ ] Обратная связь собрана
- [ ] Вопросы задокументированы

---

### Неделя 8: Промышленный запуск

#### День 1-3: Финальное тестирование

**Задачи:**
- [ ] Нагрузочное тестирование
- [ ] Проверка отказоустойчивости
- [ ] Security scan

**Чеклист:**
- [ ] 100+ одновременных пользователей
- [ ] Restart контейнеров работает
- [ ] Уязвимости отсутствуют

---

#### День 4: Подготовка к запуску

**Задачи:**
- [ ] Создать announcement
- [ ] Подготовить rollback план
- [ ] Назначить ответственных

---

#### День 5: Production запуск

**Задачи:**
- [ ] Опубликовать анонс
- [ ] Включить сервис
- [ ] Мониторить метрики

**Rollback план:**
```bash
# При критических проблемах
ops down support
# Вернуть старую систему (если была)
```

---

## Чеклист готовности

### Инфраструктура
- [ ] Docker Compose настроен
- [ ] Сеть и volumes работают
- [ ] Health checks проходят
- [ ] Ресурсы ограничены

### Интеграции
- [ ] Keycloak SSO работает
- [ ] Email настроены
- [ ] Caddy маршрутизирует
- [ ] Бэкапы работают

### Zammad
- [ ] Группы и роли созданы
- [ ] Overviews настроены
- [ ] Triggers работают
- [ ] База знаний наполнена
- [ ] Отчёты доступны

### Документация
- [ ] README обновлён
- [ ] ARCHITECTURE.md создан
- [ ] Runbook написан
- [ ] Пользовательская документация готова

### Мониторинг
- [ ] Метрики собираются
- [ ] Логи в Loki
- [ ] Алерты настроены
- [ ] Дашборд создан

### Безопасность
- [ ] HTTPS работает
- [ ] Секреты защищены
- [ ] Доступы ограничены
- [ ] Security scan пройден

---

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Недостаточно RAM | Средняя | Высокое | Увеличить лимиты, оптимизировать ES |
| Keycloak недоступен | Низкая | Высокое | Кэшировать сессии, иметь fallback |
| Email не работают | Средняя | Среднее | Использовать альтернативный SMTP |
| Потеря данных | Низкая | Критическое | Регулярные бэкапы, тестирование restore |
