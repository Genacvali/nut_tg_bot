# 🚀 Деплой Edge Functions

## 1. Установите Supabase CLI
```bash
npm install -g supabase
```

## 2. Логин
```bash
supabase login
```

## 3. Линкуйте проект
```bash
cd /home/gena1/nut_tg_bot
supabase link --project-ref itlqgwevcuoysdmuttwy
```

## 4. Добавьте секреты
```bash
supabase secrets set TELEGRAM_BOT_TOKEN="ваш_токен"
supabase secrets set OPENAI_API_KEY="ваш_ключ"
supabase secrets set SUPABASE_URL="https://itlqgwevcuoysdmuttwy.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="ваш_anon_ключ"
```

## 5. Деплой всех функций
```bash
supabase functions deploy telegram-webhook
supabase functions deploy daily-reports
supabase functions deploy photo-analysis
supabase functions deploy export-data
```

## 6. Настройте webhook
```bash
curl -X POST "https://api.telegram.org/botВАШ_ТОКЕН/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook"}'
```

## 7. Проверьте webhook
```bash
curl "https://api.telegram.org/botВАШ_ТОКЕН/getWebhookInfo"
```

## Локальная разработка
```bash
supabase functions serve telegram-webhook
```

## Просмотр логов
```bash
supabase functions logs telegram-webhook
supabase functions logs daily-reports
```
