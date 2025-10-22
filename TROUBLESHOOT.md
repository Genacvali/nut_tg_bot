# 🔍 Диагностика проблемы

## Проверка 1: Edge Function создана?

1. Откройте: https://itlqgwevcuoysdmuttwy.supabase.co
2. Edge Functions → должна быть функция `telegram-webhook`
3. Статус должен быть "Active" (зеленый)

**Если функции НЕТ:**
- Создайте её через веб-интерфейс
- Скопируйте код из `supabase/functions/telegram-webhook/index.ts`
- Нажмите Deploy

## Проверка 2: Секреты установлены?

1. Edge Functions → Secrets
2. Должны быть ВСЕ 4 секрета:
   - `TELEGRAM_BOT_TOKEN` = 7885443438:AAFuWyxKApHly8kl4QJLHr7qGd1w3NQrJHg
   - `OPENAI_API_KEY` = ваш ключ OpenAI
   - `SUPABASE_URL` = https://itlqgwevcuoysdmuttwy.supabase.co
   - `SUPABASE_ANON_KEY` = ваш anon ключ

**Если чего-то нет:**
- Нажмите "Add new secret"
- Добавьте недостающие

## Проверка 3: Логи функции

1. Edge Functions → telegram-webhook → Logs
2. Посмотрите последние ошибки

**Типичные ошибки:**
- `Secret not found` → секреты не установлены
- `Permission denied` → проблема с RLS в базе
- `Function not found` → функция не задеплоена

## Проверка 4: База данных

1. Table Editor → должны быть таблицы:
   - users
   - meals
   - checkins

**Если таблиц нет:**
- SQL Editor → выполните SQL из `supabase/migrations/20241022000000_setup_tables.sql`

## Проверка 5: Тестовый запрос

Выполните в терминале:

```bash
curl -X POST "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook" \
  -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":123},"from":{"id":123,"username":"test"},"text":"/start"}}'
```

**Ожидаемый результат:**
```json
{"ok":true}
```

**Если ошибка:**
- Смотрите текст ошибки
- Проверяйте логи в Supabase

---

## 🎯 ЛУЧШЕЕ РЕШЕНИЕ: Пошаговая проверка

Следуйте этим шагам по порядку и сообщите, на каком застряли.
