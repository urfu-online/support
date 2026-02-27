# Руководство по обслуживанию

## Ежедневные операции

### Проверка статуса сервиса

```bash
# Статус всех контейнеров
ops list

# Детальный статус
docker compose ps

# Проверка health checks
docker compose ps --format "table {{.Name}}\t{{.Status}}"
```

### Просмотр логов

```bash
# Логи в реальном времени
ops logs support -f

# Последние 100 строк
ops logs support --tail=100

# Логи конкретного контейнера
docker compose logs -f zammad-web
docker compose logs -f zammad-worker
docker compose logs -f postgres
```

### Проверка очереди заявок

```bash
# Через API Zammad
curl -s https://help.openedu.urfu.ru/api/v1/tickets \
  -H "Authorization: Token token=<TOKEN>" \
  | jq '. | length'

# Через PostgreSQL
docker compose exec postgres psql -U zammad zammad -c \
  "SELECT count(*) FROM tickets WHERE state_id IN (SELECT id FROM ticket_states WHERE name IN ('new', 'open'));"
```

---

## Еженедельные операции

### Проверка дискового пространства

```bash
# Использование volumes
docker system df -v | grep support

# Размер БД
docker compose exec postgres psql -U zammad zammad -c \
  "SELECT pg_size_pretty(pg_database_size('zammad'));"

# Размер индексов Elasticsearch
curl -s http://localhost:9200/_cat/indices?v | grep zammad
```

### Очистка старых логов

```bash
# Логи Zammad (внутри контейнера)
docker compose exec zammad-web rm -rf /opt/zammad/log/*.log.old

# Системные логи Docker
docker system prune -f
```

### Проверка бэкапов

```bash
# Список бэкапов
docker compose -f /apps/_core/backup/docker-compose.yml run restic snapshots

# Проверка последнего бэкапа
docker compose -f /apps/_core/backup/docker-compose.yml run restic snapshots --last

# Проверка целостности
docker compose -f /apps/_core/backup/docker-compose.yml run restic check
```

---

## Ежемесячные операции

### Обновление безопасности

```bash
# Проверить доступные обновления
docker compose pull

# Обновить образы
docker compose up -d --pull always

# Удалить старые образы
docker image prune -f
```

### Аудит пользователей

```bash
# Экспорт пользователей
curl -s https://help.openedu.urfu.ru/api/v1/users \
  -H "Authorization: Token token=<TOKEN>" \
  | jq '.[] | {login, email, active, role_id}' > users_$(date +%Y%m).json

# Проверить неактивных пользователей
docker compose exec postgres psql -U zammad zammad -c \
  "SELECT login, email, updated_at FROM users WHERE active = false ORDER BY updated_at DESC;"
```

### Отчёт по метрикам

```bash
# Экспорт метрик за месяц
curl -s 'http://prometheus:9090/api/v1/query_range?query=zammad_tickets_total&start=2024-01-01&end=2024-01-31&step=86400' \
  | jq '.data.result[0].values' > tickets_$(date +%Y%m).json
```

---

## Плановое обслуживание

### Перезапуск сервисов

```bash
# Мягкий перезапуск (graceful)
docker compose restart

# Полный перезапуск
ops down support
ops up support
```

### Вакuum PostgreSQL

```bash
# Стандартный vacuum
docker compose exec postgres psql -U zammad zammad -c "VACUUM ANALYZE;"

# Полный vacuum (требует больше места)
docker compose exec postgres psql -U zammad zammad -c "VACUUM FULL;"
```

### Оптимизация Elasticsearch

```bash
# Force merge индексов
curl -X POST http://localhost:9200/zammad_*/_forcemerge?max_num_segments=1

# Очистка кэша
curl -X POST http://localhost:9200/_cache/clear
```

---

## Мониторинг

### Ключевые метрики

| Метрика | Порог | Действие |
|---------|-------|----------|
| CPU usage | > 80% | Увеличить лимиты |
| Memory usage | > 90% | Оптимизировать ES heap |
| Disk usage | > 85% | Очистить логи/бэкапы |
| Open tickets | > 100 | Уведомить команду |
| Response time | > 5s | Проверить БД/ES |

### Prometheus запросы

```promql
# Количество открытых заявок
zammad_tickets{state="open"}

# Среднее время ответа
rate(zammad_response_time_seconds_sum[1h]) / rate(zammad_response_time_seconds_count[1h])

# Использование памяти
container_memory_usage_bytes{service="support"} / container_spec_memory_limit_bytes{service="support"}

# Количество ошибок в логах
sum(rate(loki_distributor_lines_processed_total{service="support",level="error"}[5m]))
```

### Алерты

```yaml
# alerts/support.yml
groups:
  - name: support
    rules:
      - alert: SupportServiceDown
        expr: up{service="support"} == 0
        for: 5m
        annotations:
          summary: "Сервис Support недоступен"
          
      - alert: SupportHighMemory
        expr: container_memory_usage_bytes{service="support"} / container_spec_memory_limit_bytes{service="support"} > 0.9
        for: 10m
        annotations:
          summary: "Высокое использование памяти Support"
          
      - alert: SupportOpenTickets
        expr: zammad_tickets{state="open"} > 100
        for: 1h
        annotations:
          summary: "Много открытых заявок в Support"
```

---

## Диагностика проблем

### Медленные запросы

```bash
# Включить логирование медленных запросов
docker compose exec postgres psql -U zammad zammad -c \
  "ALTER SYSTEM SET log_min_duration_statement = 1000;"
docker compose restart postgres

# Просмотреть логи
docker compose logs postgres | grep "duration:"
```

### Проблемы с поиском

```bash
# Проверить статус Elasticsearch
curl http://localhost:9200/_cluster/health?pretty

# Проверить индексы
curl http://localhost:9200/_cat/indices/zammad_*?v

# Пересоздать индекс
curl -X POST http://localhost:9200/_reindex -H 'Content-Type: application/json' -d '{
  "source": {"index": "zammad_tickets_old"},
  "dest": {"index": "zammad_tickets"}
}'
```

### Проблемы с email

```bash
# Проверить логи почтового процессора
docker compose logs zammad-worker | grep -i email

# Тест IMAP
docker compose exec zammad-web zammad execute::Import::Exchange --imap \
  --server mail.openedu.urfu.ru --user support@openedu.urfu.ru --password <PWD>

# Тест SMTP
docker compose exec zammad-web zammad execute::SendTestEmail \
  --to test@example.com --subject "Test" --body "Test email"
```

---

## Резервное копирование

### Ручной бэкап

```bash
# Бэкап PostgreSQL
docker compose exec postgres pg_dump -U zammad zammad > backup_zammad_$(date +%Y%m%d).sql

# Бэкап Elasticsearch
curl -X PUT "http://localhost:9200/_snapshot/support_backup/$(date +%Y%m%d)" \
  -H 'Content-Type: application/json' -d '{
  "indices": "zammad_*",
  "ignore_unavailable": true,
  "include_global_state": false
}'

# Бэкап файлов Zammad
tar -czf backup_zammad_files_$(date +%Y%m%d).tar.gz /apps/services/public/support/data/zammad
```

### Восстановление из бэкапа

```bash
# Остановить сервис
ops down support

# Восстановить PostgreSQL
cat backup_zammad_20240101.sql | docker compose exec -T postgres psql -U zammad zammad

# Восстановить Elasticsearch
curl -X POST "http://localhost:9200/_snapshot/support_backup/20240101/_restore" \
  -H 'Content-Type: application/json' -d '{
  "indices": "zammad_*",
  "ignore_unavailable": true,
  "include_global_state": false
}'

# Восстановить файлы
tar -xzf backup_zammad_files_20240101.tar.gz -C /apps/services/public/support/data/

# Запустить сервис
ops up support
```

---

## Обновление версий

### Обновление Zammad

```bash
# Проверить доступную версию
docker pull zammad/zammad:latest

# Остановить сервис
ops down support

# Обновить docker-compose.yml (указать новую версию)
# image: zammad/zammad:7.1

# Запустить
ops up support

# Проверить версию
curl https://help.openedu.urfu.ru/api/v1/system_status | jq .version
```

### Миграция данных

```bash
# Zammad автоматически выполняет миграции при старте
# Проверить логи миграции
docker compose logs zammad-web | grep -i migrate
```

---

## Безопасность

### Аудит доступа

```bash
# Экспорт логов аутентификации
docker compose logs zammad-web | grep -i "login\|auth" > auth_log_$(date +%Y%m).txt

# Проверить неудачные попытки
docker compose logs zammad-web | grep -i "failed\|invalid" | wc -l
```

### Обновление секретов

```bash
# Сгенерировать новый секрет
openssl rand -hex 16

# Обновить в .env
sed -i "s/ZAMMAD_RAILS_SECRET=.*/ZAMMAD_RAILS_SECRET=$(openssl rand -hex 16)/" .env

# Перезапустить сервис
ops restart support
```

### Сканирование уязвимостей

```bash
# Trivy сканирование образов
trivy image zammad/zammad:latest
trivy image postgres:15
trivy image redis:7-alpine
trivy image elasticsearch:8.11.0
```

---

## Контакты и эскалация

| Уровень | Контакт | Время реакции |
|---------|---------|---------------|
| L1 | support@urfu.ru | 1 час |
| L2 | sysadmin@urfu.ru | 4 часа |
| L3 | devops@urfu.ru | 8 часов |

### Чеклист эскалации

- [ ] Проблема задокументирована
- [ ] Логи собраны
- [ ] Временное решение применено
- [ ] Команда уведомлена
- [ ] Тикет создан
