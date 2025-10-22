# 🚀 Запуск бота - настройка webhook

Теперь нужно настроить webhook в Telegram.

## Шаг 1: Проверьте, что функция задеплоена

В Supabase Dashboard → Edge Functions вы должны видеть функцию `telegram-webhook` со статусом "Active".

URL функции:
```
https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook
```

## Шаг 2: Настройте webhook

Выполните эту команду в терминале (замените ВАШ_ТОКЕН на реальный токен бота):

```bash
curl -X POST "https://api.telegram.org/botВАШ_ТОКЕН/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook"}'
```

Если всё правильно, должно вернуться:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

## Шаг 3: Проверьте webhook

```bash
curl "https://api.telegram.org/botВАШ_ТОКЕН/getWebhookInfo"
```

Должно вернуться:
```json
{
  "ok": true,
  "result": {
    "url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Шаг 4: Проверьте работу бота

1. Откройте Telegram
2. Найдите вашего бота
3. Отправьте `/start`
4. Должно прийти приветствие! 🎉

## ⚠️ Если не работает

Проверьте логи в Supabase Dashboard → Edge Functions → telegram-webhook → Logs
