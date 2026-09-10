# Telegram при блокировках Bot API

Нативный канал Zammad (Channels → Telegram) ходит в HTTP Bot API:
`https://api.telegram.org/bot<token>/…`.

## Что не поможет

### Flowseal/tg-ws-proxy

[tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy) — клиентский обход загрузки Telegram (WebSocket/MTProto для приложений).
Он **не проксирует** `api.telegram.org` и **не оживит** канал Zammad / Bot API.

### MTProto proxy «как в приложении»

Zammad использует обычный HTTP-клиент, не MTProto. Параметры MTProxy (host/port/secret) в Zammad задать нельзя.

## Матрица рабочих вариантов

| Способ | Исходящие к Bot API | Входящие updates | Когда выбирать |
| --- | --- | --- | --- |
| **A.** `HTTPS_PROXY` / SOCKS на `zammad-web` и `zammad-worker` | Да | Native webhook, если DC Telegram достучится до публичного HTTPS FQDN | Быстрый тест нативного канала |
| **C.** Bridge `telegram-bridge` + long polling + тот же proxy | Да | Bridge сам poll’ит через proxy | **Рекомендуется** в этом проекте |
| **B.** Local Bot API + форк с TDLib proxy | Да | Через local API; base URL в UI Zammad не настраивается | Только если нужен именно native UI |
| tg-ws-proxy / MTProto в Zammad | Нет | Нет | Не использовать |

## Нужен ли VPS за рубежом?

**Нет, не обязательно.** Нужен стабильный **egress** до `api.telegram.org`.

Вариант C в этом репозитории:

1. Контейнер `telegram-bridge` крутится рядом с Zammad (тот же compose).
2. До Telegram ходит через `TELEGRAM_PROXY` / `HTTPS_PROXY` (HTTP или SOCKS5).
3. Long polling — Telegram не обязан пушить webhook на сервер в РФ.

Варианты egress (от простого к тяжёлому):

1. Готовый SOCKS5/HTTP proxy или корпоративный egress.
2. Маленький VPS abroad **только как proxy** (dante, 3proxy, `ssh -D`, WireGuard + SOCKS).
3. VPS abroad с самим `telegram-bridge`, Zammad остаётся в РФ (bridge → Zammad REST по HTTPS).

## Проверка доступа

```bash
# Напрямую с хоста/контейнера
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"

# Через SOCKS5
curl -sS -x "socks5h://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:1080" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"

# Через HTTP proxy
curl -sS -x "http://${PROXY_HOST}:8080" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

Если без proxy — ошибка/таймаут, с proxy — JSON с `"ok":true` → достаточно proxy, отдельный VPS под весь helpdesk не нужен.

Из контейнера bridge:

```bash
docker compose exec telegram-bridge wget -qO- \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" || true
```

## Вариант A (нативный канал + proxy)

В `docker-compose.yml` для `zammad-web` и `zammad-worker` (и при необходимости только для исходящих к TG):

```yaml
environment:
  - HTTPS_PROXY=http://proxy.example:8080
  - HTTP_PROXY=http://proxy.example:8080
  - NO_PROXY=postgres,redis,elasticsearch,localhost,127.0.0.1,zammad-web
```

Не направляйте через proxy внутренний трафик к Postgres/Redis/ES.

Минус: webhook setWebhook всё равно идёт через тот же HTTP-клиент; входящие delivery зависят от доступности вашего FQDN со стороны Telegram.

## Вариант C (рекомендуется): `telegram-bridge`

См. [CHANNELS_BRIDGES.md](./CHANNELS_BRIDGES.md).

Кратко:

1. Отключить нативный канал Telegram в Zammad (избежать дублей).
2. Заполнить в `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PROXY`, `ZAMMAD_*`, `BRIDGE_*`.
3. Поднять `telegram-bridge`.
4. Настроить Zammad Webhook на `https://<host>/bridges/telegram/internal/zammad-outbound` для ответов агента.

## Вариант B (кратко)

Форк вроде [avbor/docker-telegram-bot-api](https://github.com/avbor/docker-telegram-bot-api) умеет TDLib-proxy (HTTP/SOCKS/MTProto) к инфраструктуре Telegram.
Zammad по умолчанию ходит на `api.telegram.org` и **не даёт** сменить base URL в UI — нужны патч, DNS/TLS-трюки или всё равно отдельный bridge. Для этого проекта не целевой путь.
