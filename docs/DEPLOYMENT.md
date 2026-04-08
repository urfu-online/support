# Руководство по развёртыванию

## Предварительные требования

### Системные требования

| Ресурс | Минимум | Рекомендуется |
|--------|---------|---------------|
| CPU | 4 ядра | 6 ядер |
| RAM | 6 ГБ | 8 ГБ |
| Диск | 50 ГБ | 100 ГБ SSD |

### Зависимости платформы

- Docker ≥ 24.0
- Docker Compose Plugin
- Платформенная сеть `platform_network`
- Платформенный Caddy
- Внешний Keycloak: `openedu.urfu.ru/auth/`

---

## Быстрый старт

### Шаг 1: Клонирование и подготовка

```bash
cd /apps/services/public/support

# Инициализировать секреты
./scripts/init-secrets.sh

# Проверить конфигурацию
docker compose config
```

### Шаг 2: Запуск сервиса

```bash
# Запустить все сервисы
ops up support

# Проверить статус
ops list

# Просмотреть логи
ops logs support -f
```

### Шаг 3: Первичная настройка

1. Открыть `https://help.openedu.urfu.ru`
2. Пройти мастер начальной настройки Zammad
3. Создать учётную запись администратора
4. Настроить OIDC провайдер (Keycloak)

---

## Подробная инструкция

### 1. Подготовка окружения

#### 1.1. Проверка сети

```bash
# Проверить наличие platform_network
docker network ls | grep platform

# Если нет — создать
docker network create platform_network
```

#### 1.2. Генерация секретов

```bash
cd /apps/services/public/support

# Создать .env из примера
cp .env.example .env

# Сгенерировать безопасные секреты
./scripts/init-secrets.sh
```

#### 1.3. Настройка переменных окружения

Отредактировать `.env`:

```bash
# Email конфигурация
EMAIL_IMAP_SERVER=mail.openedu.urfu.ru
EMAIL_IMAP_PORT=993
EMAIL_IMAP_USER=support@openedu.urfu.ru
EMAIL_IMAP_PASSWORD=<пароль>

EMAIL_SMTP_SERVER=smtp.openedu.urfu.ru
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=support@openedu.urfu.ru
EMAIL_SMTP_PASSWORD=<пароль>

# Keycloak
KEYCLOAK_URL=https://openedu.urfu.ru/auth
KEYCLOAK_REALM=master
KEYCLOAK_CLIENT_ID=zammad-help
KEYCLOAK_CLIENT_SECRET=<из Keycloak>
```

### 2. Настройка Keycloak

#### 2.1. Создание клиента

1. Войти в админ-панель Keycloak
2. Выбрать realm `master`
3. Создать клиент:
   - **Client ID**: `zammad-help`
   - **Client protocol**: `openid-connect`
   - **Access type**: `confidential`
   - **Valid redirect URIs**: `https://help.openedu.urfu.ru/auth/callback`
   - **Valid post logout redirect URIs**: `https://help.openedu.urfu.ru`

4. Сохранить и скопировать **Client Secret**

#### 2.2. Настройка маппинга ролей

```
Client Scopes → zammad-help → Add Mapper
- Name: groups
- Mapper Type: Group Membership
- Token Claim Name: groups
- Add to ID token: ON
- Add to access token: ON
```

### 3. Развёртывание

#### 3.1. Запуск контейнеров

```bash
cd /apps/services/public/support

# Запустить в фоновом режиме
docker compose up -d

# Проверить статус
docker compose ps

# Дождаться готовности всех сервисов
docker compose logs -f
```

#### 3.2. Проверка health checks

```bash
# PostgreSQL
docker compose exec postgres pg_isready -U zammad

# Redis
docker compose exec redis redis-cli ping

# Elasticsearch
curl -f http://localhost:9200/_cluster/health

# Zammad
curl -f http://localhost:3000/api/v1/status
```

#### 3.3. Перезагрузка Caddy

```bash
# Применить новую конфигурацию
ops reload
```

### 4. Первичная настройка Zammad

#### 4.1. Мастер начальной настройки

1. Открыть `https://help.openedu.urfu.ru`
2. Заполнить:
   - Organization name
   - Admin email
   - Admin password
3. Нажать **Submit**

#### 4.2. Настройка OIDC

```bash
# Получить токен администратора
TOKEN=$(curl -s -X POST https://help.openedu.urfu.ru/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<password>"}' \
  | jq -r '.api_token')

# Создать OIDC провайдер
curl -X POST https://help.openedu.urfu.ru/api/v1/channels_oidc \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Keycloak URFU",
    "issuer": "https://openedu.urfu.ru/auth/realms/master",
    "client_id": "zammad-help",
    "client_secret": "<CLIENT_SECRET>",
    "scope": "openid email profile",
    "active": true
  }'
```

#### 4.3. Настройка email

```bash
# Создать email канал
curl -X POST https://help.openedu.urfu.ru/api/v1/channels_email \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "inbound": {
      "type": "IMAP",
      "server": "mail.openedu.urfu.ru",
      "port": 993,
      "ssl": true,
      "user": "support@openedu.urfu.ru",
      "password": "<PASSWORD>",
      "folder": "INBOX"
    },
    "outbound": {
      "server": "smtp.openedu.urfu.ru",
      "port": 587,
      "tls": true,
      "user": "support@openedu.urfu.ru",
      "password": "<PASSWORD>"
    }
  }'
```

### 5. Настройка бэкапов

#### 5.1. Проверка интеграции

```bash
# Проверить наличие скрипта бэкапа
ls -la /apps/_core/backup/schedules/

# Должен появиться файл support.yml
cat /apps/_core/backup/schedules/support.yml
```

#### 5.2. Тестовый бэкап

```bash
# Запустить бэкап вручную
docker compose -f /apps/_core/backup/docker-compose.yml run restic backup

# Проверить наличие бэкапа
docker compose -f /apps/_core/backup/docker-compose.yml run restic snapshots
```

### 6. Мониторинг

#### 6.1. Проверка логов

```bash
# Логи сервиса
ops logs support

# Логи в Loki (через Grafana)
# Открыть http://<grafana-url>/explore
# Query: {service="support"}
```

#### 6.2. Метрики Prometheus

```bash
# Проверить доступность метрик
curl -s http://localhost:3000/metrics | head -20

# Запросить конкретную метрику
curl -s http://prometheus:9090/api/v1/query?query=up{service="support"}
```

#### 6.3. Дашборд Grafana

1. Открыть Grafana
2. Импортировать дашборд из `docs/grafana-dashboard.json`
3. Настроить алерты

---

## Проверка работоспособности

### Чеклист

- [ ] `https://help.openedu.urfu.ru` доступен
- [ ] `https://help.urfu.online` доступен
- [ ] SSO через Keycloak работает
- [ ] Email получаются и отправляются
- [ ] Health check проходит
- [ ] Логи пишутся в Loki
- [ ] Метрики собираются Prometheus
- [ ] Бэкапы создаются

### Тестовые сценарии

#### 1. Создание заявки через веб-форму

```
1. Открыть https://help.openedu.urfu.ru
2. Нажать "Создать заявку"
3. Заполнить форму
4. Отправить
5. Проверить получение уведомления
```

#### 2. Создание заявки через email

```
1. Отправить письмо на support@openedu.urfu.ru
2. Проверить создание тикета в Zammad
3. Проверить ответ
```

#### 3. SSO аутентификация

```
1. Открыть https://help.openedu.urfu.ru
2. Нажать "Войти"
3. Перенаправление на Keycloak
4. Войти
5. Проверить возврат в Zammad
```

---

## Troubleshooting

### Сервис не запускается

```bash
# Проверить логи
ops logs support

# Проверить конфигурацию
docker compose config

# Проверить сеть
docker network inspect platform_network
```

### Ошибка подключения к PostgreSQL

```bash
# Проверить статус БД
docker compose exec postgres pg_isready -U zammad

# Проверить переменные окружения
docker compose exec postgres env | grep POSTGRES

# Пересоздать БД
docker compose down
rm -rf data/postgres
docker compose up -d postgres
```

### Elasticsearch не индексирует

```bash
# Проверить статус кластера
curl http://localhost:9200/_cluster/health

# Проверить индексы
curl http://localhost:9200/_cat/indices

# Пересоздать индекс
curl -X DELETE http://localhost:9200/zammad_tickets
```

### Keycloak не аутентифицирует

```bash
# Проверить клиент
curl -s https://openedu.urfu.ru/auth/realms/master/.well-known/openid-configuration

# Проверить токен
curl -X POST https://openedu.urfu.ru/auth/realms/master/protocol/openid-connect/token \
  -d "client_id=zammad-help" \
  -d "client_secret=<SECRET>" \
  -d "grant_type=client_credentials"
```

---

## Rollback

### Быстрый откат

```bash
# Остановить сервис
ops down support

# Вернуть предыдущую версию (если была)
# ...
```

### Восстановление из бэкапа

```bash
# Остановить сервис
ops down support

# Восстановить данные
./scripts/restore.sh <BACKUP_DATE>

# Запустить сервис
ops up support
```

---

## Контакты

- **Техническая поддержка**: support@urfu.ru
- **Документация**: https://help.openedu.urfu.ru/help
- **Мониторинг**: https://grafana.openedu.urfu.ru
