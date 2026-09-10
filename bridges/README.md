# Channel bridges: Max, VK, Telegram

Операторы: см. [docs/CHANNELS_BRIDGES.md](../docs/CHANNELS_BRIDGES.md).
Telegram / блокировки: [docs/TELEGRAM_BYPASS.md](../docs/TELEGRAM_BYPASS.md).

```
bridges/
  shared/     # Zammad client, Redis session map, outbound webhook
  max/        # MAX Bot API webhook
  vk/         # VK Callback API
  telegram/   # Bot API long polling + optional TELEGRAM_PROXY
```

Сборка (из корня `support`):

```bash
docker compose --profile max build max-bridge
docker compose --profile vk build vk-bridge
docker compose --profile telegram build telegram-bridge
```
