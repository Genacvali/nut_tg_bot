# ⚡ Быстрый старт T-Bank платежей

## 📋 Что нужно сделать (5 шагов)

### 1️⃣ Примени SQL миграцию

**В Supabase SQL Editor:**

Открой и выполни файл:
```
supabase/migration/tbank_payments.sql
```

**Проверь результат:**
```sql
SELECT id, name, duration_days, price_rub FROM subscription_plans;
```

Должны быть цены: 0₽ (Trial), 199₽ (1 Month), 499₽ (3 Months), 1990₽ (1 Year)

---

### 2️⃣ Установи Secrets

```bash
cd /home/gena1/nut_tg_bot

# Тестовые credentials T-Bank (у тебя уже есть!)
supabase secrets set TBANK_TERMINAL_KEY="1761323978364DEMO"
supabase secrets set TBANK_PASSWORD="Mt6zkbFgb3sTXl0A"

# Имя твоего бота (без @)
supabase secrets set BOT_USERNAME="твой_бот"
```

**Где взять имя бота?**
- Открой @BotFather
- Найди своего бота
- Имя после @ (например: `cid_nutrition_bot`)

---

### 3️⃣ Задеплой Edge Functions

```bash
# Deploy все 3 функции
supabase functions deploy tbank-payment --no-verify-jwt
supabase functions deploy tbank-webhook --no-verify-jwt
supabase functions deploy telegram-bot --no-verify-jwt
```

**Проверь что задеплоились:**
```bash
supabase functions list
```

---

### 4️⃣ Настрой Webhook в T-Bank

1. Зайди в личный кабинет T-Bank Business (тестовый)
2. Найди раздел "Уведомления" или "Webhooks"
3. Добавь URL:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/tbank-webhook
```

**YOUR_PROJECT_REF найди в:**
- Supabase Dashboard → Settings → API → Project URL

4. Выбери события:
   - ✅ AUTHORIZED
   - ✅ CONFIRMED
   - ✅ REJECTED

---

### 5️⃣ Протестируй!

#### A. Создай нового пользователя
1. В Telegram: `/start`
2. Заполни профиль
3. После создания плана увидишь:
   ```
   🎁 Пробный период: 7 дней
   💡 Сейчас тебе ничего вводить не нужно - никаких данных карт!
   ```

#### B. Симулируй истечение trial

**В Supabase SQL Editor:**
```sql
-- Найди свой user_id
SELECT id, telegram_id FROM users ORDER BY created_at DESC LIMIT 5;

-- Обнови подписку (подставь свой user_id)
UPDATE user_subscriptions 
SET end_date = NOW() - INTERVAL '1 day'
WHERE user_id = 123; -- <-- Твой user_id
```

#### C. Проверь оплату

1. В боте нажми "👤 Профиль"
2. Должна появиться кнопка "💳 Купить подписку"
3. Выбери "1 месяц - 199₽"
4. Нажми "💳 Оплатить"
5. Введи тестовую карту:
   ```
   Карта: 5555 5555 5555 4444
   Срок: 12/26
   CVV: 123
   ```
6. Подтверди оплату
7. Должно прийти уведомление:
   ```
   🎉 Оплата прошла успешно!
   📦 Подписка: 1 Month
   💰 Сумма: 199₽
   ```

---

## ✅ Готово!

Если все 5 шагов прошли успешно - **интеграция работает**! 🎉

---

## 🐛 Если что-то не работает

### Проблема: "T-Bank credentials not configured"

```bash
# Проверь secrets
supabase secrets list

# Если пусто - установи заново (Шаг 2)
```

### Проблема: "Invalid signature" в webhook

```bash
# Проверь логи
supabase functions logs tbank-webhook

# Проверь что пароль правильный
supabase secrets list
```

### Проблема: Подписка не активируется

```sql
-- Проверь платеж
SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT 5;

-- Проверь подписку
SELECT * FROM user_subscriptions ORDER BY created_at DESC LIMIT 5;

-- Ручная активация (если нужно)
SELECT activate_subscription_after_payment('PAYMENT_INTENT_ID');
```

---

## 📚 Подробная документация

Полная инструкция: `TBANK_SETUP_COMPLETE.md`

---

## 🎯 Следующий шаг: Production

Когда тесты пройдены:
1. Зарегистрируй настоящий терминал в T-Bank
2. Обнови secrets с production credentials
3. Готово к запуску! 🚀

---

**Удачи! 💪**

