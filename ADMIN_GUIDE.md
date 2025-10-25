# 🔧 Админская панель управления подписками

## 📋 Быстрый старт

### 1. Примени SQL миграцию
```sql
-- В Supabase SQL Editor выполни:
supabase/migration/admin_subscription_management.sql
```

### 2. Открой SQL Editor в Supabase Dashboard
Supabase Dashboard → SQL Editor → New Query

---

## 👀 Просмотр подписок

### Все подписки:
```sql
SELECT * FROM admin_subscriptions_view 
ORDER BY expires_at DESC;
```

### Только активные:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE status_emoji = '✅ Active'
ORDER BY expires_at DESC;
```

### Только истекшие:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE status_emoji = '🔒 Expired'
ORDER BY expires_at DESC;
```

### Триалы:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE status_emoji = '🎁 Trial'
ORDER BY expires_at DESC;
```

### Безлимитные:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE status_emoji = '✨ Unlimited'
ORDER BY expires_at DESC;
```

### Поиск по username:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE username ILIKE '%Gena%'
ORDER BY expires_at DESC;
```

### Топ плательщиков:
```sql
SELECT * FROM admin_subscriptions_view 
WHERE total_paid_rub > 0
ORDER BY total_paid_rub DESC
LIMIT 10;
```

---

## ✏️ Управление подписками

### 1. Продлить подписку на N дней
```sql
-- Продлить на 30 дней для user_id = 12
SELECT admin_extend_subscription(12, 30);

-- Продлить на 90 дней
SELECT admin_extend_subscription(12, 90);

-- Продлить на год
SELECT admin_extend_subscription(12, 365);
```

### 2. Дать безлимитную подписку
```sql
-- Дать безлимит пользователю с user_id = 12
SELECT admin_grant_unlimited(12);
```

**Когда использовать:**
- Близкие и друзья
- VIP клиенты
- Компенсация за проблемы
- Промо акции

### 3. Отменить подписку (заблокировать)
```sql
-- Отменить подписку для user_id = 12
SELECT admin_cancel_subscription(12);
```

**Когда использовать:**
- Нарушение правил
- Возврат средств
- Блокировка пользователя

### 4. Изменить план подписки
```sql
-- Изменить на месячный план
SELECT admin_change_plan(12, 'monthly');

-- Изменить на квартальный (3 месяца)
SELECT admin_change_plan(12, 'quarterly');

-- Изменить на годовой
SELECT admin_change_plan(12, 'yearly');

-- Дать триал
SELECT admin_change_plan(12, 'trial');

-- Дать безлимит
SELECT admin_change_plan(12, 'unlimited');
```

### 5. Сбросить триал (дать новый)
```sql
-- Дать новый 7-дневный триал для user_id = 12
SELECT admin_reset_trial(12);
```

**Когда использовать:**
- У пользователя были проблемы
- Промо акция
- Тестирование

---

## 🔍 Полезные запросы

### Найти user_id по telegram_id:
```sql
SELECT id, telegram_id, username, first_name 
FROM users 
WHERE telegram_id = 148767610;
```

### Найти user_id по username:
```sql
SELECT id, telegram_id, username, first_name 
FROM users 
WHERE username ILIKE '%Gena%';
```

### История платежей пользователя:
```sql
SELECT * FROM payment_details
WHERE user_id = 12
ORDER BY created_at DESC;
```

### Активность пользователя:
```sql
SELECT * FROM users_full_info
WHERE user_id = 12;
```

---

## 🎯 Типичные сценарии

### Сценарий 1: Дать безлимит другу
```sql
-- 1. Найди user_id
SELECT id, username FROM users WHERE username ILIKE '%друга_username%';

-- 2. Дай безлимит (подставь user_id)
SELECT admin_grant_unlimited(12);

-- 3. Проверь
SELECT * FROM admin_subscriptions_view WHERE user_id = 12;
```

### Сценарий 2: Продлить подписку клиенту
```sql
-- 1. Найди user_id
SELECT id, username FROM users WHERE username ILIKE '%клиента_username%';

-- 2. Продли на месяц (подставь user_id)
SELECT admin_extend_subscription(12, 30);

-- 3. Проверь
SELECT * FROM admin_subscriptions_view WHERE user_id = 12;
```

### Сценарий 3: Компенсация за проблемы
```sql
-- 1. Найди user_id
SELECT id, username FROM users WHERE telegram_id = 148767610;

-- 2. Дай дополнительно 14 дней (подставь user_id)
SELECT admin_extend_subscription(12, 14);

-- Или дай новый триал
SELECT admin_reset_trial(12);
```

### Сценарий 4: Апгрейд с месяца на год
```sql
-- 1. Найди user_id
SELECT id, username FROM users WHERE username ILIKE '%username%';

-- 2. Измени план (подставь user_id)
SELECT admin_change_plan(12, 'yearly');

-- 3. Проверь
SELECT * FROM admin_subscriptions_view WHERE user_id = 12;
```

### Сценарий 5: Заблокировать пользователя
```sql
-- 1. Найди user_id
SELECT id, username FROM users WHERE username ILIKE '%нарушителя%';

-- 2. Отмени подписку (подставь user_id)
SELECT admin_cancel_subscription(12);

-- 3. Проверь
SELECT * FROM admin_subscriptions_view WHERE user_id = 12;
```

---

## 📊 Статистика и аналитика

### Общая статистика подписок:
```sql
SELECT 
  status_emoji,
  COUNT(*) as count,
  SUM(total_paid_rub) as revenue
FROM admin_subscriptions_view
GROUP BY status_emoji
ORDER BY count DESC;
```

### Доход за сегодня:
```sql
SELECT 
  COUNT(*) as payments,
  SUM(amount_rub) as revenue
FROM payment_intents
WHERE created_at::date = CURRENT_DATE
  AND status = 'CONFIRMED';
```

### Доход за месяц:
```sql
SELECT 
  COUNT(*) as payments,
  SUM(amount_rub) as revenue
FROM payment_intents
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
  AND status = 'CONFIRMED';
```

### Самые популярные планы:
```sql
SELECT 
  plan_name,
  COUNT(*) as count
FROM admin_subscriptions_view
WHERE plan_name IS NOT NULL
GROUP BY plan_name
ORDER BY count DESC;
```

### Истекающие подписки (следующие 7 дней):
```sql
SELECT * FROM admin_subscriptions_view
WHERE days_left > 0 
  AND days_left <= 7
  AND status_emoji IN ('✅ Active', '🎁 Trial')
ORDER BY days_left ASC;
```

---

## ⚠️ Важно

### Безопасность:
- ✅ Все функции используют `SECURITY DEFINER` - безопасно
- ✅ Доступны только через SQL Editor (требуется логин в Supabase)
- ✅ Все действия можно отменить

### Права доступа:
- Только админы Supabase могут выполнять эти функции
- Обычные пользователи через PostgREST не имеют доступа

### Логирование:
- Все изменения автоматически логируются в БД
- Можно посмотреть историю через `updated_at` в таблицах

---

## 🆘 Частые вопросы

**Q: Как найти user_id если знаю только username в Telegram?**
```sql
SELECT id, telegram_id, username FROM users 
WHERE username ILIKE '%username%';
```

**Q: Как отменить действие?**
```sql
-- Если случайно отменил подписку:
SELECT admin_extend_subscription(12, 30);

-- Если дал не тот план:
SELECT admin_change_plan(12, 'monthly');
```

**Q: Можно ли дать подписку пользователю у которого ее еще нет?**
```sql
-- Да! Просто используй любую функцию:
SELECT admin_grant_unlimited(12);
-- или
SELECT admin_change_plan(12, 'monthly');
```

**Q: Как посмотреть кто сколько заплатил?**
```sql
SELECT 
  username,
  total_payments,
  total_paid_rub
FROM admin_subscriptions_view
WHERE total_paid_rub > 0
ORDER BY total_paid_rub DESC;
```

---

## 📱 Быстрые команды (скопируй и подставь user_id)

```sql
-- Дать безлимит
SELECT admin_grant_unlimited(USER_ID);

-- Продлить на месяц
SELECT admin_extend_subscription(USER_ID, 30);

-- Дать годовую подписку
SELECT admin_change_plan(USER_ID, 'yearly');

-- Новый триал
SELECT admin_reset_trial(USER_ID);

-- Заблокировать
SELECT admin_cancel_subscription(USER_ID);
```

---

**Готово! Теперь у тебя полный контроль над подписками!** 🎉💪



