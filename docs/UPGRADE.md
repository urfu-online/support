# Безопасное обновление Zammad

Инструкция для продакшена (`help.openedu.urfu.ru`) без потери данных.
Данные живут на bind-mounts: Postgres, Redis, Elasticsearch, `./data/zammad/storage`.
Обновление образа их не удаляет; миграции выполняет сервис `zammad-init`.

Официальная справка: [Updating Zammad](https://docs.zammad.org/en/latest/install/update.html).

## Перед обновлением

1. Узнать текущую версию:

```bash
curl -sS https://help.openedu.urfu.ru/api/v1/system_status | jq .
docker compose exec zammad-web cat /opt/zammad/VERSION 2>/dev/null || true
```

2. Прочитать release notes целевой версии: breaking changes, нужен ли rebuild Elasticsearch, смена major Postgres/ES.

3. Не пропускать major-версии Zammad (путь вида `6.x → 7.0 → 7.x`, не прыжок через major).

4. Зафиксировать текущий образ (для отката):

```bash
docker inspect support-zammad-web --format '{{.Config.Image}} {{.Image}}'
docker image ls --digests | grep zammad/zammad
```

5. Сделать бэкап (обязательно):

```bash
./scripts/prepare-backup.sh
# плюс платформенный restic / снимок томов
docker compose exec -T postgres pg_dump -U zammad zammad | gzip > "/tmp/zammad_db_$(date +%Y%m%d_%H%M%S).sql.gz"
tar -czf "/tmp/zammad_storage_$(date +%Y%m%d_%H%M%S).tar.gz" ./data/zammad/storage
```

6. Согласовать окно обслуживания и предупредить агентов.

## Пин тега образа

В `docker-compose.yml` якорь `x-zammad-common` использует плавающий тег `zammad/zammad:7`.
Перед обновлением укажите **конкретный** тег с Docker Hub / release notes, например:

```yaml
image: zammad/zammad:7.1.0
```

Один и тот же тег должен стоять у `zammad-init`, `zammad-web`, `zammad-worker` (через `<<: *zammad-common`).

## Порядок обновления

```bash
cd /apps/services/public/support   # или путь к репозиторию на проде

# 1. Остановить фоновые задачи
docker compose stop zammad-worker

# 2. Подтянуть новые образы
docker compose pull zammad-init zammad-web zammad-worker

# 3. Миграции (init должен завершиться успешно)
docker compose up zammad-init
docker compose ps -a | grep zammad-init
# ожидается Exited (0)

# 4. Поднять web и worker
docker compose up -d zammad-web zammad-worker

# 5. Статус
docker compose ps
docker compose logs --tail=100 zammad-init
docker compose logs --tail=100 zammad-web | grep -iE 'migrate|error|started' || true
```

Альтернатива через платформенный ops (после правки тега в compose):

```bash
ops up support
```

## Проверки после обновления

- [ ] Контейнеры `zammad-web`, `zammad-worker`, `postgres`, `redis`, `elasticsearch` healthy/up
- [ ] Логин в UI, открытие существующего тикета
- [ ] Создание тестового тикета
- [ ] Поиск по тикетам работает
- [ ] Версия совпадает с целевой: `curl -sS https://help.openedu.urfu.ru/api/v1/system_status | jq .`

Если в release notes указан rebuild индекса:

```bash
docker compose exec zammad-web bundle exec rake zammad:searchindex:rebuild
```

## Откат

Если новая версия не стартует и миграции **ещё не применились** (или совместимы с откатом кода):

1. Вернуть предыдущий тег/digest в `docker-compose.yml`
2. `docker compose pull` (при необходимости) и `docker compose up -d`

Если миграции уже применились и старый код с новой схемой БД несовместим:

1. `docker compose down` (без `-v`)
2. Восстановить Postgres и storage из бэкапа: `./scripts/restore.sh <BACKUP_DATE>` или ручной `psql` + распаковка storage
3. Запустить стек на **старом** теге образа
4. При необходимости пересобрать ES: `rake zammad:searchindex:rebuild`

## Запрещено

- `docker compose down -v` — удалит данные в named volumes (у нас bind-mounts, но привычка опасна)
- Удаление `./data/postgres`, `./data/zammad`, `./data/elasticsearch`
- Одновременный major-upgrade Postgres без отдельного `pgautoupgrade` и бэкапа
- Обновление «вслепую» плавающим `:latest` / `:7` без чтения release notes

## Связанные документы

- [MAINTENANCE.md](./MAINTENANCE.md) — обслуживание и бэкапы
- [TELEGRAM_BYPASS.md](./TELEGRAM_BYPASS.md) — Telegram при блокировках
- [CHANNELS_BRIDGES.md](./CHANNELS_BRIDGES.md) — bridge Max / VK / Telegram
