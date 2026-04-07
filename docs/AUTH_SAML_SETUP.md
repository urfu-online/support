# Настройка SAML — Keycloak ↔ Zammad

**Zammad:** 7.x | **Keycloak:** `https://openedu.urfu.ru/auth` | **Домен:** `help.openedu.urfu.ru`

> ✅ **SAML — рекомендация сообщества Zammad для Keycloak.** Надёжнее OIDC, но тоже **без автоматического маппинга ролей** (роли назначаются вручную).

---

## Часть 1. Zammad — получить метаданные

> Zammad должен быть запущен. Метаданные доступны по адресу:

```
https://help.openedu.urfu.ru/auth/saml/metadata
```

Открой эту ссылку в браузере — скачается XML-файл. Он понадобится в шаге 2.

> Если Zammad ещё не запущен — сначала запусти, потом вернись сюда.

---

## Часть 2. Keycloak — создание SAML-клиента

**URL:** `https://openedu.urfu.ru/auth/admin/` → realm **`urfu`**

### Шаг 1. Создать клиент

| Меню | Действие |
|------|----------|
| **Clients** | → **Create client** → **Import** |

- Загрузи XML-файл метаданных из шага 1
- Или заполни вручную:

| Поле | Значение |
|------|----------|
| **Client ID** | `zammad-help` |
| **Client protocol** | `saml` |
| **Name** | `Zammad Support` |
| **Valid redirect URIs** | `https://help.openedu.urfu.ru/auth/saml/callback` |
| **Valid post logout redirect URIs** | `https://help.openedu.urfu.ru` |

→ **Save**

### Шаг 2. Settings (вкладка Settings)

| Поле | Значение |
|------|----------|
| **Client protocol** | `saml` |
| **Client Signature Required** | ❌ OFF |
| **Force POST Binding** | ❌ OFF |
| **Front Channel Logout** | ✅ ON |
| **Force Name ID Format** | ✅ ON |
| **Name ID Format** | `email` |
| **Valid redirect URIs** | `https://help.openedu.urfu.ru/auth/saml/callback` |
| **Valid post logout redirect URIs** | `https://help.openedu.urfu.ru` |
| **IDP Initiated SSO URL Name** | `zammad-help` |
| **IDP Initiated SSO Relay State** | *(пусто)* |

→ **Save**

### Шаг 3. Mappers — добавить атрибуты

Нужно 3 mapper'а: email, first name, last name.

#### Mapper 1: email

| Меню | Действие |
|------|----------|
| **Client scopes** → `zammad-help-dedicated` | → **Add mapper** → **By configuration** → **User Property** |

| Поле | Значение |
|------|----------|
| **Name** | `email` |
| **Property** | `email` |
| **Friendly Name** | `email` |
| **SAML Attribute Name** | `email` |
| **SAML Attribute NameFormat** | `Unspecified` |
| **Aggregate Attribute Values** | ❌ OFF |

→ **Save**

#### Mapper 2: first name

| Поле | Значение |
|------|----------|
| **Name** | `firstname` |
| **Property** | `firstName` |
| **Friendly Name** | `firstname` |
| **SAML Attribute Name** | `firstname` |
| **SAML Attribute NameFormat** | `Unspecified` |

→ **Save**

#### Mapper 3: last name

| Поле | Значение |
|------|----------|
| **Name** | `lastname` |
| **Property** | `lastName` |
| **Friendly Name** | `lastname` |
| **SAML Attribute Name** | `lastname` |
| **SAML Attribute NameFormat** | `Unspecified` |

→ **Save**

### Шаг 4. Получить сертификат IdP

| Меню | Действие |
|------|----------|
| **Realm Settings** → **Keys** | → найти **rsa-enc** или **rsa-generated** → **Certificate** → скопировать содержимое |

Нужен **публичный сертификат** (без `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----` или с ними — Zammad понимает оба варианта).

---

## Часть 3. Zammad — подключить SAML

> Делается **после** первого запуска Zammad.

### Через UI

1. Войти в Zammad под админом
2. **Settings** → **Security** → **Third Party Authentication** → **SAML**
3. Заполнить:

| Поле | Значение |
|------|----------|
| **Display name** | `Keycloak URFU` (текст кнопки на странице входа) |
| **IDP SSO target URL** | `https://openedu.urfu.ru/auth/realms/urfu/protocol/saml/clients/zammad-help` |
| **IDP certificate** | *(вставь сертификат из шага 2.4)* |
| **Name identifier format** | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| **UID attribute name** | *(пусто)* |
| **SSL verification** | ✅ ON |
| **Signing & Encrypting** | `nothing` (для начала) |

→ **Submit**

### Через API

```bash
# 1. Токен админа
TOKEN=$(curl -s -X POST https://help.openedu.urfu.ru/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}' \
  | jq -r '.api_token')

# 2. Создать SAML-провайдер
curl -s -X POST https://help.openedu.urfu.ru/api/v1/channels_saml \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Keycloak URFU",
    "idp_sso_target_url": "https://openedu.urfu.ru/auth/realms/urfu/protocol/saml/clients/zammad-help",
    "idp_certificate": "<СЕРТИФИКАТ_БЕЗ_ОБЁРТОК>",
    "name_identifier_format": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    "ssl_verify": true,
    "active": true
  }' | jq .
```

---

## Часть 4. Проверка

```bash
# 1. SAML метаданные Zammad доступны?
curl -sf https://help.openedu.urfu.ru/auth/saml/metadata | head -5
# Ответ: XML с EntityDescriptor

# 2. SAML endpoint Keycloak доступен?
curl -sf "https://openedu.urfu.ru/auth/realms/urfu/protocol/saml/clients/zammad-help" | head -5
# Ответ: HTML-форма или редирект на логин
```

**Ручной тест:**
1. Открыть `https://help.openedu.urfu.ru`
2. Кнопка **Войти через Keycloak URFU** → редирект на Keycloak
3. Войти → возврат в Zammad
4. **Manage → Users** — пользователь появился с ролью **Customer**

---

## Часть 5. Назначение ролей (вручную)

| Роль | Кому | Как |
|------|------|-----|
| **Admin** | 1-2 админам системы | Manage → Users → выбрать → Roles → ☑ Admin → Save |
| **Agent** | Операторам поддержки | Manage → Users → выбрать → Roles → ☑ Agent → Save |
| **Customer** | Всем остальным | По умолчанию, ничего делать не нужно |

---

## Troubleshooting

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `Invalid assertion consumer service URL` | Не совпадает callback URL | Проверь: `https://help.openedu.urfu.ru/auth/saml/callback` |
| `Certificate validation failed` | Сертификат не совпадает | Скопируй заново из Realm Settings → Keys → Certificate |
| `NameID not found` | Не настроен Name ID Format | Settings клиента → Force Name ID Format → ON, Format → `email` |
| Пользователь без имени | Нет mapper'ов firstname/lastname | Добавь mapper'ы (шаг 2.3) |
| Логин не работает, ошибок нет | SAML не активирован в Zammad | Settings → Security → Third Party → SAML → Active → ON |
