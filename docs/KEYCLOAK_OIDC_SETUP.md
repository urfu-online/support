# Настройка Keycloak OIDC для Zammad Support

**Дата:** 7 апреля 2026 г.
**Версия Zammad:** 7.x
**Keycloak:** `https://openedu.urfu.ru/auth/realms/master`

---

## 1. Обзор архитектуры ролей и групп Zammad

### 1.1. Роли (Roles) — что есть в Zammad

В Zammad **роли** — это наборы прав (permissions). Встроенные роли:

| Роль | Описание | Ключевые права |
|------|----------|----------------|
| **Admin** | Полный доступ к панели администрирования | `admin` (все подправа: `admin.user`, `admin.role`, `admin.group`, `admin.ticket`, `admin.api` и т.д.) |
| **Agent** | Работа с тикетами, ответ клиентам | `ticket.agent`, `chat.agent`, `knowledge_base.reader` |
| **Customer** | Создание и просмотр своих тикетов | `ticket.customer` |

**Важно:**
- Одному пользователю можно назначить **несколько ролей** одновременно (например, Agent + Customer)
- Роли нельзя удалять — только деактивировать
- Роль по умолчанию (Default at Signup) — та, что получают новые пользователи при первом входе

### 1.2. Группы (Groups) — что есть в Zammad

В Zammad **группы** — это механизм контроля доступа к тикетам, отдельный от ролей:

| Аспект | Описание |
|--------|----------|
| **Назначение** | Разделение тикетов по командам/отделам |
| **Уровни доступа** | `full access`, `read-only`, `create-only` |
| **Примеры** | `Support`, `IT`, `Sales`, `Users` |
| **Связь с ролями** | Группа определяет, какие тикеты видит пользователь с ролью Agent |

**Типичная схема:**
```
┌─────────────────────────────────────────────────────────┐
│  Пользователь: ivan@urfu.ru                            │
│  Роли: Agent, Customer                                  │
│  Группы: Support (full access), IT (read-only)          │
└─────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌────────────────┐      ┌────────────────┐
│ Видит тикеты   │      │ Видит тикеты   │
│ группы Support │      │ группы IT      │
│ (редактирует)  │      │ (только чтение)│
└────────────────┘      └────────────────┘
```

### 1.3. Итоговая матрица доступа

| Роль | Группы | Что может |
|------|--------|-----------|
| Admin | Любые | Всё: админка + все тикеты всех групп |
| Agent | Support (full) | Обрабатывать тикеты группы Support |
| Agent | IT (read-only) | Читать тикеты группы IT, но не редактировать |
| Customer | Users | Видеть только свои тикеты |

---

## 2. ⚠️ Ключевое ограничение Zammad OIDC

> **Zammad 7.x НЕ поддерживает автоматический маппинг ролей/групп через OIDC.**
>
> OIDC-провайдер используется **только для аутентификации** (подтверждение личности).
> Роли и группы назначаются **вручную** в панели администрирования Zammad.
>
> Feature Request: https://github.com/zammad/zammad/issues/4943

### Что это значит на практике:

| Ожидание | Реальность |
|----------|------------|
| «Админ в Keycloak → Admin в Zammad» | ❌ Не работает автоматически |
| «Группа support в Keycloak → Agent в Zammad» | ❌ Не работает автоматически |
| «Удалили из группы в Keycloak → права отозвались» | ❌ Не происходит |

### Обходные пути:

1. **Ручное назначение** — администратор Zammad вручную назначает роли после первого входа пользователя через SSO
2. **LDAP-синхронизация** — Zammad поддерживает LDAP sync, который может обновлять роли (но это отдельная интеграция, не OIDC)
3. **API-скрипт** — написать скрипт, который при первом логине через OIDC назначает роли на основе групп Keycloak (через Zammad API)

---

## 3. Пошаговая настройка Keycloak

### 3.1. Создание OIDC клиента

1. Войти в админ-панель Keycloak: `https://openedu.urfu.ru/auth/admin/`
2. Выбрать realm **`master`**
3. Перейти: **Clients** → **Create client**

#### Основные настройки:

| Параметр | Значение |
|----------|----------|
| **Client ID** | `zammad-help` |
| **Client protocol** | `openid-connect` |
| **Name** | `Zammad Support` |
| **Description** | `Сервис технической поддержки УрФУ` |

#### Настройки Capability config:

| Параметр | Значение |
|----------|----------|
| **Client authentication** | ✅ ON (confidential) |
| **Standard flow** | ✅ ON |
| **Direct access grants** | ✅ ON |
| **Implicit flow** | ❌ OFF |

#### Настройки Access settings:

| Параметр | Значение |
|----------|----------|
| **Valid redirect URIs** | `https://help.openedu.urfu.ru/auth/callback` |
| **Valid post logout redirect URIs** | `https://help.openedu.urfu.ru` |
| **Web origins** | `https://help.openedu.urfu.ru` |
| **Root URL** | `https://help.openedu.urfu.ru` |
| **Base URL** | `https://help.openedu.urfu.ru` |

#### Настройки Fine grain OpenID Connect configuration:

| Параметр | Значение |
|----------|----------|
| **Request object signature** | `RS256` |
| **User info signed response algorithm** | `RS256` |
| **PKCE Code Challenge Method** | `S256` |

4. Нажать **Save**
5. Перейти на вкладку **Credentials** и скопировать **Client Secret** — он понадобится для настройки Zammad

### 3.2. Создание Mappers (для передачи атрибутов)

Несмотря на то, что Zammad не маппит роли автоматически, передача атрибутов в токене пригодится для будущего API-скрипта или LDAP-синка.

#### Mapper: Groups

1. **Clients** → `zammad-help` → **Client scopes** → `zammad-help-dedicated` → **Add mapper** → **By configuration** → **Group Membership**

| Параметр | Значение |
|----------|----------|
| **Name** | `groups` |
| **Token Claim Name** | `groups` |
| **Full group path** | ❌ OFF (только имя группы) |
| **Add to ID token** | ✅ ON |
| **Add to access token** | ✅ ON |
| **Add to userinfo** | ✅ ON |

#### Mapper: Full name

| Параметр | Значение |
|----------|----------|
| **Name** | `fullname` |
| **Mapper type** | `User Property` |
| **Property** | `name` |
| **Token Claim Name** | `name` |
| **Add to ID token** | ✅ ON |

### 3.3. (Опционально) Создание групп в Keycloak

Для соответствия с Zammad-группами:

1. **Groups** → **Create group**
2. Создать группы:

| Группа в Keycloak | Соответствие в Zammad | Описание |
|-------------------|-----------------------|----------|
| `zammad-admins` | Роль: Admin | Администраторы helpdesk |
| `zammad-agents` | Роль: Agent | Операторы поддержки |
| `zammad-support` | Группа: Support (full access) | Обработка тикетов |
| `zammad-users` | Роль: Customer | Обычные пользователи |

3. Добавить пользователей в соответствующие группы

### 3.4. Настройки сессий (рекомендации)

**Realm settings** → **Tokens**:

| Параметр | Рекомендация |
|----------|--------------|
| **Access Token Lifespan** | `5 min` |
| **SSO Session Idle** | `30 min` |
| **SSO Session Max** | `10 hours` |
| **Client Session Idle** | `30 min` |
| **Client Session Max** | `10 hours` |

---

## 4. Настройка Zammad

### 4.1. Получение Client Secret

После создания клиента в Keycloak:

```bash
# Вариант 1: Через админ-панель Keycloak
# Clients → zammad-help → Credentials → Client Secret

# Вариант 2: Через API Keycloak (если есть admin token)
curl -s "https://openedu.urfu.ru/auth/admin/realms/master/clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.[] | select(.clientId == "zammad-help") | .secret'
```

### 4.2. Настройка .env

```bash
cd /apps/services/public/support

# Установить Client Secret
sed -i 's|KEYCLOAK_CLIENT_SECRET=.*|KEYCLOAK_CLIENT_SECRET=<ВАШ_SECRET>|' .env

# Перезапустить сервис
ops restart support
```

### 4.3. Создание OIDC провайдера в Zammad

После первого запуска Zammad (мастер начальной настройки):

```bash
# Получить токен администратора
TOKEN=$(curl -s -X POST https://help.openedu.urfu.ru/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@openedu.urfu.ru","password":"<ADMIN_PASSWORD>"}' \
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
    "scope": "openid email profile groups",
    "active": true,
    "disable_signup": false
  }'
```

### 4.4. Проверка OIDC провайдера

```bash
# Получить список OIDC провайдеров
curl -s https://help.openedu.urfu.ru/api/v1/channels_oidc \
  -H "Authorization: Token token=$TOKEN" | jq .

# Протестировать OIDC discovery
curl -s https://openedu.urfu.ru/auth/realms/master/.well-known/openid-configuration \
  | jq '.issuer, .authorization_endpoint, .token_endpoint'
```

---

## 5. Процесс аутентификации (пошагово)

### 5.1. Диаграмма последовательности

```
Пользователь                    Caddy Proxy               Keycloak                Zammad
     │                              │                        │                        │
     │  1. GET /                   │                        │                        │
     │─────────────────────────────>│                        │                        │
     │                              │  2. Нет сессии         │                        │
     │  3. Redirect to Keycloak     │                        │                        │
     │<─────────────────────────────│                        │                        │
     │                              │                        │                        │
     │  4. GET /auth/...            │                        │                        │
     │──────────────────────────────────────────────────────>│                        │
     │                              │                        │                        │
     │  5. Страница логина          │                        │                        │
     │<─────────────────────────────────────────────────────│                        │
     │                              │                        │                        │
     │  6. Login + password         │                        │                        │
     │──────────────────────────────────────────────────────>│                        │
     │                              │                        │                        │
     │  7. ID token + access token  │                        │                        │
     │<─────────────────────────────────────────────────────│                        │
     │                              │                        │                        │
     │  8. Redirect с кодом         │                        │                        │
     │─────────────────────────────>│                        │                        │
     │                              │  9. POST /auth/callback│                        │
     │                              │───────────────────────────────────────────────>│
     │                              │                        │                        │
     │                              │                        │  10. Validate token    │
     │                              │                        │<───────────────────────│
     │                              │                        │                        │
     │                              │                        │  11. User info         │
     │                              │                        │───────────────────────>│
     │                              │                        │                        │
     │                              │                        │  12. Найти/создать юзера│
     │                              │                        │  13. Назначить роль по умолчанию │
     │                              │                        │                        │
     │                              │  14. Session cookie    │                        │
     │<─────────────────────────────│                        │                        │
     │  15. Главный экран Zammad    │                        │                        │
     │<─────────────────────────────│                        │                        │
```

### 5.2. Что происходит на каждом шаге

| Шаг | Описание |
|-----|----------|
| 1-3 | Пользователь заходит на `help.openedu.urfu.ru`. Caddy проверяет сессию — если нет, редиректит на Keycloak |
| 4-5 | Keycloak показывает страницу входа realm `master` |
| 6-7 | Пользователь вводит логин/пароль (или через другой провайдер). Keycloak возвращает JWT-токен |
| 8-9 | Браузер возвращается на Zammad с кодом авторизации. Zammad обменивает код на токен |
| 10-11 | Zammad валидирует токен у Keycloak, получает информацию о пользователе |
| 12-13 | Zammad ищет пользователя по email. Если нет — создаёт. Назначает **роль по умолчанию** (Customer) |
| 14-15 | Сессия создана, пользователь видит главный экран Zammad |

### 5.3. Что Zammad получает из токена

| Claim | Источник | Использование |
|-------|----------|---------------|
| `sub` | Keycloak | Уникальный идентификатор пользователя |
| `email` | Keycloak | Email пользователя (основной ключ) |
| `name` / `given_name` / `family_name` | Keycloak | Имя и фамилия |
| `groups` | Keycloak (mapper) | **НЕ используется** Zammad для назначения ролей |

---

## 6. Назначение ролей после первого входа

### 6.1. Ручное назначение (через UI)

1. Войти в Zammad под администратором
2. Перейти: **Manage** → **Users**
3. Найти пользователя по email
4. В разделе **Roles** отметить нужные роли:
   - ☑ Admin — для администраторов
   - ☑ Agent — для операторов поддержки
   - ☑ Customer — для обычных пользователей
5. Нажать **Save**

### 6.2. Назначение через API

```bash
# Получить ID пользователя
USER_ID=$(curl -s "https://help.openedu.urfu.ru/api/v1/users/search?query=email:ivan@urfu.ru" \
  -H "Authorization: Token token=$TOKEN" \
  | jq -r '.[0].id')

# Получить ID роли Admin
ADMIN_ROLE_ID=$(curl -s "https://help.openedu.urfu.ru/api/v1/roles" \
  -H "Authorization: Token token=$TOKEN" \
  | jq -r '.[] | select(.name == "Admin") | .id')

# Назначить роль Admin
curl -X PUT "https://help.openedu.urfu.ru/api/v1/users/$USER_ID" \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"role_ids\": [$ADMIN_ROLE_ID]
  }"
```

### 6.3. Автоматический скрипт синхронизации (обходной путь)

Можно написать скрипт, который:
1. Забирает список пользователей и их групп из Keycloak (Admin API)
2. Забирает список пользователей из Zammad (API)
3. Сопоставляет по email
4. Назначает роли в Zammad на основе групп Keycloak

Пример логики маппинга:

```python
# Маппинг групп Keycloak → ролей Zammad
ROLE_MAPPING = {
    "zammad-admins": ["Admin"],
    "zammad-agents": ["Agent", "Customer"],
    "zammad-support": ["Agent"],
    "zammad-users": ["Customer"],
}

# Маппинг групп Keycloak → групп Zammad
GROUP_MAPPING = {
    "zammad-support": {"group": "Support", "access": "full"},
    "zammad-it": {"group": "IT", "access": "read_only"},
    "zammad-users": {"group": "Users", "access": "full"},
}
```

---

## 7. Рекомендуемая структура ролей и групп

### 7.1. Минимальная (для старта)

| Ключевая сущность | Что делать |
|-------------------|------------|
| **Роль по умолчанию** | Оставить `Customer` — новые пользователи через SSO получают только возможность создавать тикеты |
| **Admin** | Вручную назначить 1-2 администраторам системы |
| **Agent** | Вручную назначить операторам поддержки |
| **Группы** | Оставить стандартную `Users` — все видят тикеты всех |

### 7.2. Полная (для production)

```
┌──────────────────────────────────────────────────────────────┐
│                      Keycloak (urfu realm)                    │
│                                                              │
│  Группы:                                                     │
│  ├── zammad-admins (2 чел.) ─────────┐                       │
│  ├── zammad-agents (5 чел.) ────────┐│                       │
│  ├── zammad-support (5 чел.) ───────┼┼──────────────────┐    │
│  └── zammad-users (100+ чел.) ──────┼┼──────────────┐   │    │
└─────────────────────────────────────┼┼──────────────┼───┼────┘
                                      ││              │   │
         Скрипт синхронизации         ││              │   │
         (cron, каждые 5 мин)         ││              │   │
                                      ▼│              │   │
┌──────────────────────────────────────────────────────┼───┼────┐
│                      Zammad                           │   │    │
│                                                      │   │    │
│  Роли:                                               │   │    │
│  ├── Admin ← zammad-admins ──────────────────────────┘   │    │
│  ├── Agent ← zammad-agents + zammad-support ─────────────┘    │
│  └── Customer ← zammad-users                                  │
│                                                               │
│  Группы (доступ к тикетам):                                   │
│  ├── Support (full access) ← zammad-support                   │
│  ├── IT (read-only) ← zammad-agents                           │
│  └── Users (full access) ← zammad-users                       │
└───────────────────────────────────────────────────────────────┘
```

### 7.3. Таблица соответствия

| Группа Keycloak | Роль Zammad | Группа Zammad | Доступ |
|-----------------|-------------|---------------|--------|
| `zammad-admins` | Admin | Все | Полный доступ ко всему |
| `zammad-agents` | Agent, Customer | IT (read-only) | Чтение тикетов IT |
| `zammad-support` | Agent, Customer | Support (full access) | Обработка тикетов поддержки |
| `zammad-users` | Customer | Users (full access) | Только свои тикеты |

---

## 8. Проверка и тестирование

### 8.1. Тест OIDC подключения

```bash
# 1. Проверка OIDC discovery
curl -sf https://openedu.urfu.ru/auth/realms/master/.well-known/openid-configuration | jq '.issuer'
# Ожидание: "https://openedu.urfu.ru/auth/realms/master"

# 2. Получение токена (проверка клиента)
curl -s -X POST "https://openedu.urfu.ru/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=zammad-help" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=client_credentials" \
  | jq '.access_token'
# Ожидание: JWT-токен

# 3. Проверка состава токена (groups claim)
TOKEN=$(curl -s -X POST "https://openedu.urfu.ru/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=zammad-help" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=client_credentials" \
  | jq -r '.access_token')

echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .
# Проверить наличие claim "groups"
```

### 8.2. Тест входа в Zammad через SSO

1. Открыть `https://help.openedu.urfu.ru`
2. Нажать **Войти** → должен быть редирект на Keycloak
3. Войти с учётной записью УрФУ
4. Проверить возврат в Zammad
5. Проверить, что пользователь создан (Manage → Users)
6. Проверить роль (должна быть Customer по умолчанию)

### 8.3. Тест маппинга ролей (после ручного назначения)

1. Администратор Zammad назначает пользователю роль Agent
2. Пользователь выходит из системы
3. Пользователь входит через SSO повторно
4. Проверить, что роль Agent сохранилась

---

## 9. Troubleshooting

### 9.1. «Invalid redirect_uri»

**Причина:** Redirect URI в Keycloak не совпадает с тем, что отправляет Zammad.

**Решение:**
```
Keycloak: Valid redirect URIs = https://help.openedu.urfu.ru/auth/callback
```

### 9.2. «Invalid client credentials»

**Причина:** Неверный Client Secret.

**Решение:**
```bash
# Перегенерировать secret в Keycloak
# Clients → zammad-help → Credentials → Regenerate

# Обновить в Zammad
curl -X PUT "https://help.openedu.urfu.ru/api/v1/channels_oidc/<ID>" \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_secret": "<NEW_SECRET>"}'
```

### 9.3. «User not found after login»

**Причина:** Zammad ищет пользователя по email, но email не передан в токене.

**Решение:**
1. Проверить mapper email в Keycloak: **Clients** → `zammad-help` → **Client scopes** → проверить mapper `email`
2. Проверить состав токена: `echo $TOKEN | cut -d. -f2 | base64 -d | jq .`
3. Убедиться, что claim `email` присутствует

### 9.4. «SSO login loop»

**Причина:** Zammad не может создать сессию после получения токена.

**Решение:**
1. Проверить логи Zammad: `ops logs support | grep -i oidc`
2. Проверить, что `issuer` в настройках OIDC совпадает с реальным
3. Проверить time sync на сервере (JWT чувствителен к рассинхрону времени)

### 9.5. «Группы не передаются в токене»

**Причина:** Mapper groups не настроен или пользователь не состоит в группах.

**Решение:**
1. **Clients** → `zammad-help` → **Client scopes** → проверить mapper `groups`
2. Добавить пользователя в группу в Keycloak: **Users** → выбрать пользователя → **Groups** → **Join**
3. Проверить токен: `echo $TOKEN | cut -d. -f2 | base64 -d | jq '.groups'`

---

## 10. Чеклист настройки

### Keycloak (администратор Keycloak)

- [ ] Создан клиент `zammad-help` в realm `master`
- [ ] Тип клиента: `confidential`
- [ ] Redirect URI: `https://help.openedu.urfu.ru/auth/callback`
- [ ] Post logout URI: `https://help.openedu.urfu.ru`
- [ ] Скопирован Client Secret
- [ ] Настроен mapper `groups` (Group Membership)
- [ ] Настроен mapper `email`
- [ ] Настроен mapper `name`
- [ ] Созданы группы: `zammad-admins`, `zammad-agents`, `zammad-support`, `zammad-users`
- [ ] Пользователи распределены по группам
- [ ] Настройки сессий: Access Token = 5min, SSO Idle = 30min

### Zammad (администратор Zammad)

- [ ] Zammad запущен и доступен по `https://help.openedu.urfu.ru`
- [ ] Пройден мастер начальной настройки
- [ ] Создан OIDC провайдер через API
- [ ] Проверен OIDC discovery endpoint
- [ ] Тестовый вход через SSO успешен
- [ ] Пользователь создан в Zammad
- [ ] Роли назначены вручную первым пользователям
- [ ] (Опционально) Настроен скрипт синхронизации ролей

### Проект (devops)

- [ ] `KEYCLOAK_CLIENT_SECRET` установлен в `.env`
- [ ] `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` корректны
- [ ] Сервис перезапущен после изменения `.env`
- [ ] Health check проходит
- [ ] Документация обновлена
