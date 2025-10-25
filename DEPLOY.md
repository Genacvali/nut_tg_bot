# 🚀 Деплой C.I.D. Bot

## Быстрый деплой

```bash
# 1. Применить миграции БД
supabase db push

# 2. Задеплоить все функции
supabase functions deploy --no-verify-jwt

# 3. Установить webhook (один раз)
curl -X POST "https://your-project.supabase.co/functions/v1/set-webhook"
```

## Настройка переменных

```bash
# Установить секреты Supabase
supabase secrets set TELEGRAM_BOT_TOKEN=your-bot-token
supabase secrets set TBANK_TERMINAL_KEY=your-terminal-key
supabase secrets set TBANK_PASSWORD=your-password
```

## Проверка

```bash
# Логи бота
supabase functions logs telegram-bot

# Логи платежей
supabase functions logs tbank-webhook
```

## Админские операции

```sql
-- Просмотр подписок
SELECT * FROM admin_subscriptions_view;

-- Выдача безлимитной подписки
SELECT admin_grant_unlimited(telegram_id);
```
