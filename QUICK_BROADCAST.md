# 📢 Быстрая рассылка обновлений

## 🚀 Шаги для отправки рассылки

### 1. Задеплой функцию (если еще не сделал)
```bash
# В Supabase Dashboard → Edge Functions
# Создай функцию: broadcast-message
# Скопируй код из: supabase/functions/broadcast-message/index.ts
```

### 2. Примени SQL миграцию
```sql
-- В Supabase SQL Editor выполни:
-- Файл: supabase/migration/add_broadcast_helpers.sql
```

### 3. Проверь статистику
```sql
-- Посмотри сколько пользователей получат сообщение
SELECT get_broadcast_stats();
```

### 4. Отправь рассылку

**Замени YOUR_PROJECT и YOUR_SERVICE_KEY на свои значения!**

```bash
curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/broadcast-message' \
  -H 'Authorization: Bearer YOUR_SERVICE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "🎉 **Обновление C.I.D. v2.0!**\n\nПривет! Мы добавили крутые новые функции:\n\n🔥 **Streak система** - не теряй серию дней!\n⚡ **Быстрый лог** - сохраняй частые блюда\n📈 **Графики прогресса** - визуализация калорий и веса\n🛒 **Список покупок** - на основе твоего плана\n📊 **Еженедельные AI-отчеты** - персональная аналитика\n⏰ **Умные напоминания** - AI помощник\n\n💡 **Обнови бот командой /start чтобы увидеть все новинки!**\n\nТеперь путь к цели стал еще проще! 💪",
    "onlyActiveSubscribers": false,
    "delayMs": 150,
    "keyboard": [
      [{"text": "🚀 Попробовать новинки", "callback_data": "main_menu"}],
      [{"text": "👤 Профиль", "callback_data": "show_profile"}]
    ]
  }'
```

---

## 📝 Готовые шаблоны сообщений

Смотри файл **BROADCAST_EXAMPLE.md** для:
- 3 готовых шаблона (короткий, подробный, для trial)
- Все варианты использования
- Best practices

---

## ⚡ Быстрый тест (отправь только себе)

Чтобы протестировать сначала на себе:

```bash
# Найди свой telegram_id в таблице users
SELECT id, telegram_id, first_name FROM users WHERE telegram_id = YOUR_TELEGRAM_ID;

# Отправь сообщение через Telegram bot API напрямую
curl -X POST 'https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage' \
  -H 'Content-Type: application/json' \
  -d '{
    "chat_id": YOUR_TELEGRAM_ID,
    "text": "🎉 **Обновление C.I.D. v2.0!**\n\n...",
    "parse_mode": "Markdown"
  }'
```

---

## 📊 Проверка результатов

После отправки получишь ответ:
```json
{
  "success": true,
  "total_users": 150,
  "sent": 148,
  "failed": 2
}
```

---

**⚠️ ВАЖНО: Сначала протестируй на себе, потом отправляй всем!**
