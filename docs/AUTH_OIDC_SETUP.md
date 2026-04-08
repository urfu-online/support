# Настройка OIDC (OpenID Connect) — Keycloak ↔ Zammad

**Zammad:** 7.x | **Keycloak:** `https://openedu.urfu.ru/auth` | **Домен:** `help.openedu.urfu.ru`

> ⚠️ **OIDC = только аутентификация.** Роли назначаются вручную в Zammad. Маппинг ролей через OIDC не поддерживается ([#4943](https://github.com/zammad/zammad/issues/4943)).

---

## Часть 1. Keycloak — создание клиента

**URL:** `https://openedu.urfu.ru/auth/admin/` → realm **`master`**

### Шаг 1. Создать клиент

| Меню | Действие |
|------|----------|
| **Clients** | → **Create client** |

| Поле | Значение |
|------|----------|
| **Client ID** | `zammad-help` |
| **Client protocol** | `openid-connect` |
| **Name** | `Zammad Support` |

→ **Next**

### Шаг 2. Capability config

| Поле | Вкл/Выкл |
|------|----------|
| **Client authentication** | ✅ ON |
| **Standard flow** | ✅ ON |
| **Direct access grants** | ✅ ON |
| **Implicit flow** | ❌ OFF |

### Шаг 3. Access settings

| Поле | Значение |
|------|----------|
| **Valid redirect URIs** | `https://help.openedu.urfu.ru/auth/callback` |
| **Valid post logout redirect URIs** | `https://help.openedu.urfu.ru` |
| **Web origins** | `https://help.openedu.urfu.ru` |

→ **Save**

### Шаг 4. Скопировать Client Secret

| Меню | Действие |
|------|----------|
| **Credentials** | → скопировать **Client secret** |

Сохранить — понадобится в шаге 2.

### Шаг 5. Добавить mapper для email

| Меню | Действие |
|------|----------|
| **Client scopes** → `zammad-help-dedicated` | → **Add mapper** → **By configuration** → **User Property** |

| Поле | Значение |
|------|----------|
| **Name** | `email` |
| **Property** | `email` |
| **Token Claim Name** | `email` |
| **Add to ID token** | ✅ ON |

→ **Save**

---

## Часть 2. Проект — установить секрет

```bash
cd /apps/services/public/support

# Вставить secret в .env
sed -i 's|KEYCLOAK_CLIENT_SECRET=.*|KEYCLOAK_CLIENT_SECRET=<СКОПИРОВАННЫЙ_SECRET>|' .env

# Перезапустить
ops restart support
```

---

## Часть 3. Zammad — подключить OIDC

> Делается **после** первого запуска Zammad (пройден мастер начальной настройки).

### Через API (быстро)

```bash
# 1. Получить токен админа
TOKEN=$(curl -s -X POST https://help.openedu.urfu.ru/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}' \
  | jq -r '.api_token')

# 2. Создать OIDC-провайдер
curl -s -X POST https://help.openedu.urfu.ru/api/v1/channels_oidc \
  -H "Authorization: Token token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Keycloak URFU",
    "issuer": "https://openedu.urfu.ru/auth/realms/master",
    "client_id": "zammad-help",
    "client_secret": "<CLIENT_SECRET>",
    "scope": "openid email profile",
    "active": true,
    "disable_signup": false
  }' | jq .
```

### Через UI (если удобнее)

1. Войти в Zammad под админом
2. **Settings** → **Security** → **Third Party Authentication** → **OpenID Connect**
3. Заполнить:

| Поле | Значение |
|------|----------|
| **Name** | `Keycloak URFU` |
| **Issuer** | `https://openedu.urfu.ru/auth/realms/master` |
| **Client ID** | `zammad-help` |
| **Client Secret** | `<из шага 1.4>` |
| **Scopes** | `openid email profile` |
| **Active** | ✅ |

4. **Submit**

---

## Часть 4. Проверка

```bash
# 1. OIDC discovery работает?
curl -sf https://openedu.urfu.ru/auth/realms/master/.well-known/openid-configuration | jq '.issuer'
# Ответ: "https://openedu.urfu.ru/auth/realms/master"

# 2. Клиент валиден?
curl -s -X POST "https://openedu.urfu.ru/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=zammad-help" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=client_credentials" | jq '.access_token'
# Ответ: JWT-токен (не error)
```

**Ручной тест:**
1. Открыть `https://help.openedu.urfu.ru`
2. Кнопка **Войти через Keycloak** → редирект на Keycloak
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
| `Invalid redirect_uri` | Не совпадает URI в Keycloak | Проверь: `https://help.openedu.urfu.ru/auth/callback` |
| `Invalid client credentials` | Неверный secret | Clients → zammad-help → Credentials → Regenerate → обнови в Zammad |
| Пользователь не создаётся | Нет claim `email` в токене | Проверь mapper email (шаг 1.5) |
| Login loop | issuer не совпадает или рассинхрон времени | Проверь `issuer` и `timedatectl` на сервере |
