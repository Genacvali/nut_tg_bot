# Supabase Edge Functions для Telegram бота

## Структура

```
functions/
├── telegram-bot/        # Основной обработчик webhook
│   └── index.ts
├── set-webhook/         # Установка webhook (вызывается один раз)
│   └── index.ts
└── _shared/             # Общие модули
    ├── openai.ts        # Интеграция с OpenAI
    └── calculators.ts   # Калькуляторы КБЖУ
```

## Функции

### telegram-bot
Основной обработчик входящих обновлений от Telegram.

**URL:** `https://your-project.supabase.co/functions/v1/telegram-bot`

**Обрабатывает:**
- Команды (/start, /help)
- Текстовые сообщения
- Callback queries (inline кнопки)
- Голосовые сообщения (в разработке)

**Переменные окружения:**
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `SUPABASE_URL` (автоматически)
- `SUPABASE_SERVICE_ROLE_KEY` (автоматически)

### set-webhook
Устанавливает webhook для Telegram бота.

**URL:** `https://your-project.supabase.co/functions/v1/set-webhook`

**Использование:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/set-webhook
```

Вызывается **один раз** после деплоя функций.

## Деплой

### Деплой всех функций
```bash
./deploy.sh
```

### Деплой отдельной функции
```bash
supabase functions deploy telegram-bot
```

### Локальное тестирование
```bash
supabase functions serve telegram-bot
```

## Мониторинг

### Просмотр логов
```bash
supabase functions logs telegram-bot --tail
```

### Метрики
Dashboard → Edge Functions → telegram-bot → Metrics

## Разработка

### Добавление новой функции
1. Создайте папку в `functions/`
2. Создайте `index.ts`
3. Деплой: `supabase functions deploy your-function`

### Использование shared модулей
```typescript
import { analyzeFood } from '../_shared/openai.ts'

const result = await analyzeFood(description)
```

## Отладка

### Проверка webhook
```bash
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

### Удаление webhook (для отладки)
```bash
curl https://api.telegram.org/bot<TOKEN>/deleteWebhook
```

### Тестовый запрос
```bash
curl -X POST http://localhost:54321/functions/v1/telegram-bot \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {"id": 123, "first_name": "Test"},
      "chat": {"id": 123, "type": "private"},
      "text": "/start"
    }
  }'
```

## Лучшие практики

1. **Быстрый ответ** - отвечайте Telegram за 5 секунд
2. **Асинхронность** - длительные операции делайте фоново
3. **Обработка ошибок** - всегда оборачивайте в try-catch
4. **Логирование** - используйте console.log для отладки
5. **Типы** - используйте TypeScript для безопасности

## Ограничения Edge Functions

- **Время выполнения:** до 150 секунд
- **Память:** до 150 MB
- **Размер payload:** до 6 MB
- **Холодный старт:** 1-2 секунды

## Масштабирование

Edge Functions автоматически масштабируются, но для оптимизации:

1. Кэшируйте частые запросы
2. Используйте батчинг для БД
3. Оптимизируйте размер ответов
4. Минимизируйте зависимости

## Дополнительно

См. [EDGE_FUNCTIONS_SETUP.md](../EDGE_FUNCTIONS_SETUP.md) для полной документации.

