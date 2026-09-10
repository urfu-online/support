# Channel bridges: Max, VK, Telegram

Bridge-сервисы принимают сообщения из мессенджеров и создают/обновляют тикеты в Zammad через REST API.
Ответы агента уходят обратно через Zammad Webhook → bridge → API мессенджера.

Подробности по Telegram и блокировкам: [TELEGRAM_BYPASS.md](./TELEGRAM_BYPASS.md).
Обновление Zammad: [UPGRADE.md](./UPGRADE.md).

## Архитектура

```
User → Max/VK webhook или Telegram long polling
     → bridge контейнер
     → Zammad REST (ticket + article)
     → агент отвечает в UI
     → Zammad Webhook → bridge /internal/zammad-outbound
     → sendMessage в мессенджер
```

Маппинг `external_chat_id ↔ ticket_id` хранится в Redis (`bridge:{channel}:…`) с per-chat lock (без гонок на двойное создание тикета).

## Возможности каналов Max / VK

| Функция | Max | VK |
| --- | --- | --- |
| Текст ↔ тикет | да | да |
| Вложения inbound | image/file/video/audio | photo, doc, voice, audio; video → текстовая метка |
| Вложения outbound (ответ агента) | image/video/audio/file + retry `attachment.not.ready` | photo / doc |
| `/end`, «закрыть» — сброс сессии Redis | да | да |
| Закрытие тикета при `/end` | `BRIDGE_END_CLOSES_TICKET` | то же |
| Webhook secret | `X-Max-Bot-Api-Secret` / `MAX_WEBHOOK_SECRET` | `VK_CALLBACK_SECRET` |
| API | `platform-api2.max.ru` | `api.vk.com` |

Telegram-профиль в compose пока не дорабатываем.

После `/end` маппинг chat↔ticket удаляется; следующее сообщение создаёт новый тикет.

## Общие секреты (.env)

| Переменная | Назначение |
| --- | --- |
| `ZAMMAD_URL` | Внутри сети: `http://zammad-web:3000` |
| `ZAMMAD_TOKEN` | API token пользователя Zammad (права на Users + Tickets) |
| `ZAMMAD_GROUP_ID` | ID группы, куда падают тикеты |
| `BRIDGE_OUTBOUND_SECRET` | Общий секрет для заголовка `X-Bridge-Secret` |
| `REDIS_URL` | Тот же Redis, что у Zammad |
| `BRIDGE_END_CLOSES_TICKET` | `true`/`false` — закрывать тикет при `/end` (по умолчанию `true`) |
| `BRIDGE_GOODBYE_MESSAGE` | Текст после закрытия диалога |

Создать token в Zammad: Profile → Token Access → права `ticket.agent`, `admin.user` (или эквивалент для создания customers/tickets).

## Запуск

Профили Compose (ядро Zammad поднимается без них):

```bash
cd /apps/services/public/support   # путь на проде

# один или несколько каналов
docker compose --profile max --profile vk --profile telegram up -d --build
```

Проверка health:

```bash
curl -sS https://help.openedu.urfu.ru/bridges/max/health
curl -sS https://help.openedu.urfu.ru/bridges/vk/health
curl -sS https://help.openedu.urfu.ru/bridges/telegram/health
```

Маршруты `/bridges/*` должны уходить на контейнеры bridge (см. `service.yml`), не на `zammad-web`.
Нужен **HTTPS с доверенным сертификатом** (для Max обязательно).

## Max

1. Создать бота в [MAX для партнёров](https://dev.max.ru/docs/chatbots/bots-coding/prepare), пройти модерацию, взять токен.
2. В `.env`: `MAX_BOT_TOKEN`, `MAX_WEBHOOK_URL=https://help.openedu.urfu.ru/bridges/max/webhook`.
3. `docker compose --profile max up -d --build`.
4. При старте bridge пытается `POST /subscriptions`; при ошибке подпишите webhook вручную по [доке MAX](https://dev.max.ru/docs/chatbots/bots-coding/prepare).
5. Написать боту в MAX → в Zammad появится тикет с префиксом `MAX:`.

## VK

1. Создать сообщество / Callback API по [быстрому старту](https://dev.vk.com/ru/api/bots/getting-started).
2. В `.env`: `VK_GROUP_TOKEN`, `VK_GROUP_ID`, `VK_CONFIRMATION`, опционально `VK_CALLBACK_SECRET`.
3. URL Callback: `https://help.openedu.urfu.ru/bridges/vk/callback`.
4. Событие: `message_new`.
5. `docker compose --profile vk up -d --build`.
6. Сообщение в ЛС сообщества → тикет `VK:…`.

## Telegram (вариант C)

1. Создать бота у @BotFather, взять token.
2. **Отключить** нативный канал Channels → Telegram в Zammad (иначе дубли).
3. В `.env`: `TELEGRAM_BOT_TOKEN`, при блокировке Bot API — `TELEGRAM_PROXY` (`socks5h://…` или `http://…`).
4. Проверка egress:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
curl -sS -x "$TELEGRAM_PROXY" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

5. `docker compose --profile telegram up -d --build`.
6. Bridge удаляет webhook и работает long polling — входящий push от DC Telegram на ваш сервер не нужен.
7. `/start` и текстовое сообщение → тикет `TG:…`.

VPS abroad не обязателен: достаточно рабочего proxy до `api.telegram.org`. См. [TELEGRAM_BYPASS.md](./TELEGRAM_BYPASS.md).

## Zammad Webhook (ответы агента)

Для **каждого** включённого bridge создайте Webhook в Zammad (Admin → Webhook / Trigger):

| Поле | Значение |
| --- | --- |
| Endpoint | `http://max-bridge:8080/bridges/max/internal/zammad-outbound` (внутри Docker) или публичный HTTPS URL |
| Method | POST |
| Header | `X-Bridge-Secret: <BRIDGE_OUTBOUND_SECRET>` |
| Trigger | Article created, sender Agent, not internal |

Аналогично для VK (`vk-bridge`, `/bridges/vk/...`) и Telegram (`telegram-bridge`, `/bridges/telegram/...`).

Внутри `platform_network` удобнее слать на имя сервиса (`http://max-bridge:8080/...`), без выхода в интернет.

Payload должен содержать `ticket_id` (или `ticket.id`) и `article` с `body` / `sender` / `internal`.

## Smoke-тест

1. Написать боту из мессенджера тестовую фразу.
2. В Zammad: новый тикет, customer `max_*` / `vk_*` / `telegram_*`.
3. Ответить публичным article от агента.
4. Ответ приходит в тот же чат мессенджера.
5. Логи: `docker compose logs -f max-bridge` (или `vk-bridge` / `telegram-bridge`).

## Ограничения

- VK video без прямой ссылки кладётся в тикет как `.txt`-заметка (не бинарник).
- Стикеры / wall / gift / link в VK и sticker/share/keyboard в Max не импортируются.
- Размер вложений ограничен API мессенджера и `MAX_ATTACHMENT_MAX_BYTES` / `VK_ATTACHMENT_MAX_BYTES`.
- После смены кода shared сначала: `cd bridges/shared && npm run build` (типы в `dist/`).

## Ручная проверка сборки (локально)

```bash
cd bridges/shared && npm install && npm run build
cd ../max && npm install && npm run build
cd ../vk && npm install && npm run build
cd ../telegram && npm install && npm run build
```

Тесты в CI/проде агент не запускает — выполняйте команды выше сами при необходимости.
