# 🎯 Быстрое обновление

## 1. Обновите telegram-webhook (2 минуты)

```
Supabase Dashboard → Edge Functions → telegram-webhook → Replace code
```

Скопируйте весь код из: `supabase/functions/telegram-webhook/index.ts`

## 2. Настройте cron (1 минута)

```
Supabase Dashboard → SQL Editor → New query
```

Скопируйте код из: `supabase/migrations/20241022000001_setup_cron.sql`

## 3. Проверьте

```sql
SELECT * FROM cron.job;
```

## ✅ Готово!

Теперь бот понимает:
- 📝 Текст
- 📷 Фото
- 🎤 Голос

И отправляет отчеты каждый день в 21:00!
