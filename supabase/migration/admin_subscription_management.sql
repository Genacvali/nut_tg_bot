-- ============================================
-- АДМИНСКАЯ ПАНЕЛЬ ДЛЯ УПРАВЛЕНИЯ ПОДПИСКАМИ
-- ============================================
-- Удобные функции для управления подписками пользователей
-- ============================================

-- 1. VIEW: Удобный просмотр всех подписок
-- ============================================

DROP VIEW IF EXISTS admin_subscriptions_view;

CREATE VIEW admin_subscriptions_view AS
SELECT 
  us.id as subscription_id,
  
  -- Пользователь
  u.id as user_id,
  u.telegram_id,
  u.username,
  u.first_name,
  
  -- Подписка
  sp.name as plan_name,
  us.status,
  us.started_at,
  us.expires_at,
  us.is_trial,
  us.is_unlimited,
  
  -- Статус
  CASE 
    WHEN us.is_unlimited THEN '✨ Unlimited'
    WHEN us.expires_at > NOW() AND us.status = 'active' THEN '✅ Active'
    WHEN us.expires_at > NOW() AND us.status = 'trial' THEN '🎁 Trial'
    WHEN us.expires_at <= NOW() THEN '🔒 Expired'
    ELSE '❓ Unknown'
  END as status_emoji,
  
  -- Дней осталось
  CASE 
    WHEN us.is_unlimited THEN 999999
    WHEN us.expires_at > NOW() THEN EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER
    ELSE 0 
  END as days_left,
  
  -- Платежи
  (
    SELECT COUNT(*) 
    FROM payment_intents 
    WHERE user_id = u.id AND status = 'CONFIRMED'
  ) as total_payments,
  
  (
    SELECT COALESCE(SUM(amount_rub), 0)
    FROM payment_intents 
    WHERE user_id = u.id AND status = 'CONFIRMED'
  ) as total_paid_rub,
  
  -- Активность
  (
    SELECT MAX(created_at)
    FROM food_logs 
    WHERE user_id = u.id
  ) as last_activity

FROM user_subscriptions us
JOIN users u ON us.user_id = u.id
LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
ORDER BY us.expires_at DESC;

COMMENT ON VIEW admin_subscriptions_view IS 'Админская панель: все подписки пользователей';

-- 2. ФУНКЦИЯ: Продлить подписку
-- ============================================

CREATE OR REPLACE FUNCTION admin_extend_subscription(
  p_user_id BIGINT,
  p_days INTEGER
)
RETURNS TEXT AS $$
DECLARE
  v_subscription user_subscriptions;
BEGIN
  -- Получаем текущую подписку
  SELECT * INTO v_subscription
  FROM user_subscriptions
  WHERE user_id = p_user_id
  ORDER BY expires_at DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN '❌ Подписка не найдена для пользователя ' || p_user_id;
  END IF;
  
  -- Продлеваем
  UPDATE user_subscriptions
  SET 
    expires_at = expires_at + (p_days || ' days')::INTERVAL,
    status = 'active'
  WHERE id = v_subscription.id;
  
  RETURN '✅ Подписка продлена на ' || p_days || ' дней для пользователя ' || p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_extend_subscription IS 'Продлить подписку пользователя на N дней';

-- 3. ФУНКЦИЯ: Дать безлимитную подписку
-- ============================================

CREATE OR REPLACE FUNCTION admin_grant_unlimited(
  p_user_id BIGINT
)
RETURNS TEXT AS $$
DECLARE
  v_unlimited_plan_id BIGINT;
BEGIN
  -- Получаем ID безлимитного плана
  SELECT id INTO v_unlimited_plan_id
  FROM subscription_plans
  WHERE name = 'unlimited'
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN '❌ План "unlimited" не найден';
  END IF;
  
  -- Обновляем/создаем подписку
  INSERT INTO user_subscriptions (
    user_id,
    plan_id,
    status,
    started_at,
    expires_at,
    is_trial,
    is_unlimited
  )
  VALUES (
    p_user_id,
    v_unlimited_plan_id,
    'active',
    NOW(),
    NOW() + INTERVAL '100 years',
    FALSE,
    TRUE
  )
  ON CONFLICT (user_id) 
  WHERE status IN ('trial', 'active')
  DO UPDATE SET
    plan_id = v_unlimited_plan_id,
    status = 'active',
    expires_at = NOW() + INTERVAL '100 years',
    is_unlimited = TRUE;
  
  RETURN '✨ Безлимитная подписка выдана пользователю ' || p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_grant_unlimited IS 'Дать пользователю безлимитную подписку';

-- 4. ФУНКЦИЯ: Отменить подписку (заблокировать)
-- ============================================

CREATE OR REPLACE FUNCTION admin_cancel_subscription(
  p_user_id BIGINT
)
RETURNS TEXT AS $$
BEGIN
  UPDATE user_subscriptions
  SET 
    status = 'cancelled',
    expires_at = NOW() - INTERVAL '1 day'
  WHERE user_id = p_user_id
    AND status IN ('trial', 'active');
  
  IF NOT FOUND THEN
    RETURN '❌ Активная подписка не найдена для пользователя ' || p_user_id;
  END IF;
  
  RETURN '🔒 Подписка отменена для пользователя ' || p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_cancel_subscription IS 'Отменить подписку пользователя (заблокировать)';

-- 5. ФУНКЦИЯ: Изменить план подписки
-- ============================================

CREATE OR REPLACE FUNCTION admin_change_plan(
  p_user_id BIGINT,
  p_plan_name TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_plan_id BIGINT;
  v_duration INTEGER;
BEGIN
  -- Получаем план
  SELECT id, duration_days INTO v_plan_id, v_duration
  FROM subscription_plans
  WHERE name = p_plan_name
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN '❌ План "' || p_plan_name || '" не найден';
  END IF;
  
  -- Обновляем подписку
  UPDATE user_subscriptions
  SET 
    plan_id = v_plan_id,
    status = 'active',
    expires_at = NOW() + (v_duration || ' days')::INTERVAL,
    is_trial = FALSE
  WHERE user_id = p_user_id
    AND status IN ('trial', 'active', 'cancelled');
  
  IF NOT FOUND THEN
    RETURN '❌ Подписка не найдена для пользователя ' || p_user_id;
  END IF;
  
  RETURN '✅ План изменен на "' || p_plan_name || '" для пользователя ' || p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_change_plan IS 'Изменить план подписки пользователя';

-- 6. ФУНКЦИЯ: Сбросить триал
-- ============================================

CREATE OR REPLACE FUNCTION admin_reset_trial(
  p_user_id BIGINT
)
RETURNS TEXT AS $$
DECLARE
  v_trial_plan_id BIGINT;
BEGIN
  -- Получаем ID триала
  SELECT id INTO v_trial_plan_id
  FROM subscription_plans
  WHERE name = 'trial'
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN '❌ План "trial" не найден';
  END IF;
  
  -- Обновляем подписку
  UPDATE user_subscriptions
  SET 
    plan_id = v_trial_plan_id,
    status = 'trial',
    started_at = NOW(),
    expires_at = NOW() + INTERVAL '7 days',
    is_trial = TRUE,
    is_unlimited = FALSE
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN '❌ Подписка не найдена для пользователя ' || p_user_id;
  END IF;
  
  RETURN '🎁 Триал сброшен (7 дней) для пользователя ' || p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_reset_trial IS 'Сбросить триал пользователя (дать новый 7-дневный период)';

-- ============================================
-- ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
-- ============================================

-- Посмотреть все подписки:
-- SELECT * FROM admin_subscriptions_view ORDER BY expires_at DESC;

-- Посмотреть истекшие подписки:
-- SELECT * FROM admin_subscriptions_view WHERE status_emoji = '🔒 Expired';

-- Продлить подписку на 30 дней:
-- SELECT admin_extend_subscription(12, 30);

-- Дать безлимит:
-- SELECT admin_grant_unlimited(12);

-- Отменить подписку:
-- SELECT admin_cancel_subscription(12);

-- Изменить план:
-- SELECT admin_change_plan(12, 'yearly');

-- Сбросить триал:
-- SELECT admin_reset_trial(12);

-- ============================================
-- ГОТОВО! 🎉
-- ============================================

