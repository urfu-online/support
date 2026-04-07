The user wants me to create a comprehensive project summary in markdown format based on the conversation history. Let me analyze what happened:

1. I was asked to analyze the current directory and generate a QWEN.md file
2. I explored the project structure, read multiple files (README.md, service.yml, docker-compose.yml, docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, docs/IMPLEMENTATION_PLAN.md, .env.example, scripts/init-secrets.sh, .gitignore)
3. I created a comprehensive QWEN.md file with all the important context

This is a Support service project based on Zammad 7.x - a helpdesk/ITSM system for handling user support tickets.

Let me create the summary following the specified format.# Project Summary

## Overall Goal
Создать comprehensive QWEN.md файл с контекстом проекта Support (сервис технической поддержки на базе Zammad) для использования в будущих сессиях с AI-ассистентом.

## Key Knowledge

### Проект
- **Сервис**: Support — система управления заявками (helpdesk/ITSM) на базе **Zammad 7.x**
- **Домены**: `help.openedu.urfu.ru` (основной), `help.urfu.online` (резервный)
- **Расположение**: `/projects/apps-service-opus/services/public/support`

### Архитектура (Docker Compose)
| Сервис | Образ | Ресурсы (CPU/RAM) |
|--------|-------|-------------------|
| zammad-web | zammad/zammad:7 | 1.0 / 2Gi |
| zammad-worker | zammad/zammad:7 | 0.5 / 1Gi |
| postgres | postgres:15-alpine | 0.5 / 1Gi |
| redis | redis:7-alpine | 0.25 / 512Mi |
| elasticsearch | elasticsearch:8.11.0 | 1.0 / 2Gi |

**Итого**: 3.25 CPU / 6.5Gi RAM

### Интеграции
- **Keycloak**: `openedu.urfu.ru/auth/realms/urfu` — SSO (OIDC)
- **Почта**: IMAP/SMTP через `mail.openedu.urfu.ru`
- **Платформа**: Caddy proxy, Loki, Prometheus, Restic (бэкапы)

### Команды управления
```bash
ops up support          # Запуск
ops down support        # Остановка
ops logs support        # Логи
ops list                # Статус
./scripts/init-secrets.sh  # Генерация секретов
```

### Health Check
- Endpoint: `/api/v1/status`
- Interval: 30s, Timeout: 10s, Retries: 3

### Бэкапы
- Расписание: ежедневно в 02:00
- Хранение: 7 дней
- Компоненты: PostgreSQL, Elasticsearch, файлы Zammad

## Recent Actions

1. **[DONE]** Прочитан README.md — получен обзор сервиса, архитектуры, быстрого старта
2. **[DONE]** Прочитан service.yml — конфигурация платформы, routing, backup, hooks
3. **[DONE]** Прочитан docker-compose.yml — детальная конфигурация всех 5 сервисов
4. **[DONE]** Прочитаны docs/ARCHITECTURE.md и docs/DEPLOYMENT.md — архитектура и развёртывание
5. **[DONE]** Прочитан docs/IMPLEMENTATION_PLAN.md — план реализации (8 недель)
6. **[DONE]** Прочитаны .env.example и scripts/init-secrets.sh — переменные окружения
7. **[DONE]** Создан QWEN.md — comprehensive контекст для будущих сессий

## Current Plan

1. **[DONE]** Анализ структуры проекта и чтение ключевых файлов (10 файлов)
2. **[DONE]** Генерация QWEN.md с полным контекстом:
   - Обзор проекта и архитектура
   - Структура файлов
   - Команды запуска и управления
   - Конфигурация и переменные окружения
   - Мониторинг и тестирование
   - Ссылки на документацию
   - Важные замечания (Elasticsearch heap, безопасность)
3. **[DONE]** Запись QWEN.md в файловую систему

### Следующие шаги (для будущих сессий)
- [TODO] При необходимости — помощь с развёртыванием сервиса
- [TODO] При необходимости — настройка Keycloak OIDC интеграции
- [TODO] При необходимости — конфигурация email-каналов
- [TODO] При необходимости — настройка бэкапов и восстановления

---

## Summary Metadata
**Update time**: 2026-02-27T11:46:56.480Z 
