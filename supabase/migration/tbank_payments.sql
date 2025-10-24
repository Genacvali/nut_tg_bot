-- ============================================
-- T-BANK PAYMENT INTEGRATION
-- ============================================
-- Таблица для хранения платежей через T-Bank
-- Webhook автоматически активирует подписку после оплаты
-- ============================================

-- 1. Обновляем цены подписок (199₽, 499₽, 1990₽)
-- ============================================

-- Добавляем поля для цен (если их нет)
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_usd DECIMAL(10,2);

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_rub DECIMAL(10,2);

-- Обновляем цены
UPDATE subscription_plans 
SET 
  price_usd = 2.10,  -- 199₽ / 95 курс (для справки)
  price_rub = 199.00
WHERE name = '1 Month';

UPDATE subscription_plans 
SET 
  price_usd = 5.25,  -- 499₽ / 95 курс
  price_rub = 499.00
WHERE name = '3 Months';

UPDATE subscription_plans 
SET 
  price_usd = 20.95,  -- 1990₽ / 95 курс
  price_rub = 1990.00
WHERE name = '1 Year';

-- 2. Таблица платежных намерений (Payment Intents)
-- ============================================

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  
  -- T-Bank специфичные поля
  tbank_payment_id TEXT UNIQUE,  -- PaymentId от T-Bank
  order_id TEXT UNIQUE NOT NULL,  -- Наш внутренний ID заказа
  terminal_key TEXT,  -- TerminalKey использованный для платежа
  
  -- Финансовая информация
  amount_rub DECIMAL(10,2) NOT NULL,  -- Сумма в рублях (для отображения)
  amount_kopeks INTEGER NOT NULL,     -- Сумма в копейках (T-Bank требует!)
  currency TEXT DEFAULT 'RUB',
  
  -- Статус платежа
  -- T-Bank статусы: NEW, FORM_SHOWED, AUTHORIZING, 3DS_CHECKING, 3DS_CHECKED,
  --                 AUTHORIZED, CONFIRMING, CONFIRMED, REVERSING, PARTIAL_REVERSED,
  --                 REVERSED, REFUNDING, PARTIAL_REFUNDED, REFUNDED, REJECTED, CANCELLED
  status TEXT NOT NULL DEFAULT 'NEW',
  
  -- URLs
  payment_url TEXT,  -- URL для оплаты (куда отправляем клиента)
  success_url TEXT,  -- URL успешной оплаты
  fail_url TEXT,     -- URL неудачной оплаты
  
  -- Описание и метаданные
  description TEXT,
  receipt JSONB,  -- Чек для 54-ФЗ (если нужно)
  
  -- Информация об ошибках
  error_code TEXT,
  error_message TEXT,
  error_details TEXT,
  
  -- Webhook данные (последний полученный webhook)
  last_webhook_data JSONB,
  last_webhook_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,  -- Когда оплачен
  
  -- Для отладки
  request_data JSONB,  -- Запрос который отправили в T-Bank
  response_data JSONB  -- Ответ от T-Bank
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_payment_intents_user 
  ON payment_intents(user_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_status 
  ON payment_intents(status);

CREATE INDEX IF NOT EXISTS idx_payment_intents_tbank_id 
  ON payment_intents(tbank_payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_order_id 
  ON payment_intents(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_created 
  ON payment_intents(created_at DESC);

-- RLS (Row Level Security)
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;

-- Удаляем старые политики если есть
DROP POLICY IF EXISTS "Users can view own payments" ON payment_intents;
DROP POLICY IF EXISTS "Service role has full access to payments" ON payment_intents;

-- Пользователи видят только свои платежи
CREATE POLICY "Users can view own payments"
  ON payment_intents FOR SELECT
  USING (auth.uid()::text::bigint = user_id);

-- Service role может всё
CREATE POLICY "Service role has full access to payments"
  ON payment_intents FOR ALL
  USING (auth.role() = 'service_role');

-- 3. Функция: Создать платежное намерение
-- ============================================

CREATE OR REPLACE FUNCTION create_payment_intent(
  p_user_id BIGINT,
  p_plan_id INTEGER,
  p_order_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
  v_amount_rub DECIMAL(10,2);
  v_plan_name TEXT;
BEGIN
  -- Получаем информацию о плане
  SELECT price_rub, name 
  INTO v_amount_rub, v_plan_name
  FROM subscription_plans 
  WHERE id = p_plan_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_id;
  END IF;
  
  -- Создаем платежное намерение
  INSERT INTO payment_intents (
    user_id,
    plan_id,
    order_id,
    amount_rub,
    amount_kopeks,
    description,
    status
  )
  VALUES (
    p_user_id,
    p_plan_id,
    p_order_id,
    v_amount_rub,
    (v_amount_rub * 100)::INTEGER,  -- Конвертируем в копейки!
    'Подписка C.I.D.: ' || v_plan_name,
    'NEW'
  )
  RETURNING id INTO v_payment_id;
  
  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Функция: Обновить статус платежа (вызывается из webhook)
-- ============================================

CREATE OR REPLACE FUNCTION update_payment_status(
  p_order_id TEXT,
  p_tbank_payment_id TEXT,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_webhook_data JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_payment_id UUID;
  v_user_id BIGINT;
  v_plan_id INTEGER;
  v_old_status TEXT;
BEGIN
  -- Получаем информацию о платеже
  SELECT id, user_id, plan_id, status
  INTO v_payment_id, v_user_id, v_plan_id, v_old_status
  FROM payment_intents
  WHERE order_id = p_order_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Payment not found for order_id: %', p_order_id;
    RETURN FALSE;
  END IF;
  
  -- Обновляем платеж
  UPDATE payment_intents
  SET
    tbank_payment_id = p_tbank_payment_id,
    status = p_status,
    error_code = p_error_code,
    error_message = p_error_message,
    last_webhook_data = p_webhook_data,
    last_webhook_at = NOW(),
    updated_at = NOW(),
    paid_at = CASE 
      WHEN p_status = 'CONFIRMED' AND paid_at IS NULL THEN NOW()
      ELSE paid_at
    END
  WHERE id = v_payment_id;
  
  -- Если платеж подтвержден - активируем подписку
  IF p_status = 'CONFIRMED' AND v_old_status != 'CONFIRMED' THEN
    PERFORM activate_subscription_after_payment(v_payment_id);
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Функция: Активировать подписку после оплаты
-- ============================================

CREATE OR REPLACE FUNCTION activate_subscription_after_payment(
  p_payment_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_payment payment_intents;
  v_plan subscription_plans;
  v_existing_sub user_subscriptions;
BEGIN
  -- Получаем платеж
  SELECT * INTO v_payment 
  FROM payment_intents 
  WHERE id = p_payment_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Payment not found: %', p_payment_id;
    RETURN FALSE;
  END IF;
  
  -- Проверяем что платеж подтвержден
  IF v_payment.status != 'CONFIRMED' THEN
    RAISE WARNING 'Payment not confirmed: % (status: %)', p_payment_id, v_payment.status;
    RETURN FALSE;
  END IF;
  
  -- Получаем план
  SELECT * INTO v_plan 
  FROM subscription_plans 
  WHERE id = v_payment.plan_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Plan not found: %', v_payment.plan_id;
    RETURN FALSE;
  END IF;
  
  -- Проверяем есть ли активная подписка
  SELECT * INTO v_existing_sub
  FROM user_subscriptions
  WHERE user_id = v_payment.user_id
    AND status IN ('trial', 'active')
  ORDER BY expires_at DESC
  LIMIT 1;
  
  IF FOUND THEN
    -- Продлеваем существующую подписку
    UPDATE user_subscriptions
    SET
      plan_id = v_payment.plan_id,
      status = 'active',
      -- Если подписка еще активна - продлеваем от конца
      -- Если уже истекла - продлеваем от сейчас
      expires_at = CASE
        WHEN expires_at > NOW() THEN expires_at + (v_plan.duration_days * INTERVAL '1 day')
        ELSE NOW() + (v_plan.duration_days * INTERVAL '1 day')
      END,
      is_trial = FALSE
    WHERE id = v_existing_sub.id;
    
    RAISE NOTICE 'Extended subscription for user %', v_payment.user_id;
  ELSE
    -- Создаем новую подписку
    INSERT INTO user_subscriptions (
      user_id,
      plan_id,
      status,
      started_at,
      expires_at,
      is_trial
    )
    VALUES (
      v_payment.user_id,
      v_payment.plan_id,
      'active',
      NOW(),
      NOW() + (v_plan.duration_days * INTERVAL '1 day'),
      FALSE
    );
    
    RAISE NOTICE 'Created new subscription for user %', v_payment.user_id;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Функция: Получить историю платежей пользователя
-- ============================================

CREATE OR REPLACE FUNCTION get_user_payment_history(
  p_user_id BIGINT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  payment_id UUID,
  plan_name TEXT,
  amount_rub DECIMAL(10,2),
  status TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.id,
    sp.name,
    pi.amount_rub,
    pi.status,
    pi.created_at,
    pi.paid_at,
    pi.payment_url
  FROM payment_intents pi
  JOIN subscription_plans sp ON pi.plan_id = sp.id
  WHERE pi.user_id = p_user_id
  ORDER BY pi.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Views для мониторинга (опционально)
-- ============================================

-- Статистика по платежам
CREATE OR REPLACE VIEW payment_stats AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  status,
  COUNT(*) as count,
  SUM(amount_rub) as total_rub
FROM payment_intents
GROUP BY DATE_TRUNC('day', created_at), status
ORDER BY date DESC, status;

-- Детальная информация о платежах
CREATE OR REPLACE VIEW payment_details AS
SELECT
  pi.id as payment_id,
  pi.order_id,
  pi.tbank_payment_id,
  u.id as user_id,
  sp.name as plan_name,
  pi.amount_rub,
  pi.status,
  pi.created_at,
  pi.paid_at,
  pi.error_code,
  pi.error_message
FROM payment_intents pi
JOIN users u ON pi.user_id = u.id
JOIN subscription_plans sp ON pi.plan_id = sp.id
ORDER BY pi.created_at DESC;

-- ============================================
-- ГОТОВО! 🎉
-- ============================================

-- Проверка данных:
SELECT 'Subscription plans:' as info;
SELECT id, name, duration_days, price_rub, price_usd FROM subscription_plans;

SELECT '' as spacer;
SELECT 'Payment intents table created:' as info;
SELECT COUNT(*) as payment_count FROM payment_intents;

SELECT '' as spacer;
SELECT '✅ T-Bank integration ready!' as status;
SELECT '📝 Next: Create Edge Functions (tbank-payment, tbank-webhook)' as next_step;

