-- ============================================
-- ПОЛНАЯ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЯХ
-- ============================================
-- Собирает всю информацию в одном месте:
-- - Базовые данные пользователя
-- - Текущая подписка
-- - Реальная статистика LLM
-- ============================================

DROP VIEW IF EXISTS users_full_info;

CREATE VIEW users_full_info AS
SELECT 
  -- Базовая информация
  u.id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.is_admin,
  u.created_at as registered_at,
  
  -- Профиль
  up.gender,
  up.age,
  up.height,
  up.current_weight as weight_kg,
  up.activity_level,
  
  -- Подписка
  COALESCE(
    CASE 
      WHEN us.is_unlimited THEN '✨ Unlimited'
      WHEN us.status = 'trial' AND us.expires_at > NOW() THEN '🎁 Trial Active'
      WHEN us.status = 'trial' AND us.expires_at <= NOW() THEN '🔒 Trial Expired'
      WHEN us.status = 'active' AND us.expires_at > NOW() THEN '✅ Active'
      WHEN us.status = 'active' AND us.expires_at <= NOW() THEN '🔒 Expired'
      ELSE '❌ No Subscription'
    END,
    '❌ No Subscription'
  ) as subscription_status,
  
  sp.name as subscription_plan,
  us.started_at as subscription_started,
  us.expires_at as subscription_expires,
  
  CASE 
    WHEN us.expires_at > NOW() THEN 
      EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER
    ELSE 0 
  END as days_left,
  
  -- Реальная статистика LLM (из llm_usage_logs)
  (
    SELECT COUNT(*) 
    FROM llm_usage_logs 
    WHERE user_id = u.id
  ) as total_llm_requests,
  
  (
    SELECT COALESCE(SUM(total_tokens), 0)
    FROM llm_usage_logs 
    WHERE user_id = u.id
  ) as total_tokens_used,
  
  (
    SELECT COALESCE(SUM(cost_usd), 0)
    FROM llm_usage_logs 
    WHERE user_id = u.id
  ) as total_cost_usd,
  
  (
    SELECT COUNT(*) 
    FROM llm_usage_logs 
    WHERE user_id = u.id 
      AND created_at::DATE = CURRENT_DATE
  ) as requests_today,
  
  (
    SELECT COALESCE(SUM(cost_usd), 0)
    FROM llm_usage_logs 
    WHERE user_id = u.id 
      AND created_at::DATE = CURRENT_DATE
  ) as cost_today,
  
  (
    SELECT MAX(created_at)
    FROM llm_usage_logs 
    WHERE user_id = u.id
  ) as last_llm_request_at,
  
  -- Статистика еды
  (
    SELECT COUNT(*) 
    FROM food_logs 
    WHERE user_id = u.id
  ) as total_meals_logged,
  
  (
    SELECT COUNT(*) 
    FROM food_logs 
    WHERE user_id = u.id 
      AND logged_at::DATE = CURRENT_DATE
  ) as meals_today,
  
  -- Платежи
  (
    SELECT COUNT(*) 
    FROM payment_intents 
    WHERE user_id = u.id 
      AND status = 'CONFIRMED'
  ) as total_payments,
  
  (
    SELECT COALESCE(SUM(amount_rub), 0)
    FROM payment_intents 
    WHERE user_id = u.id 
      AND status = 'CONFIRMED'
  ) as total_paid_rub

FROM users u
LEFT JOIN user_profiles up ON u.id = up.user_id
LEFT JOIN LATERAL (
  SELECT * FROM user_subscriptions
  WHERE user_id = u.id
  ORDER BY expires_at DESC
  LIMIT 1
) us ON true
LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
ORDER BY u.created_at DESC;

-- Комментарий
COMMENT ON VIEW users_full_info IS 'Полная информация о пользователях: профиль, подписка, LLM, еда, платежи';

-- Проверка
SELECT 
  id,
  telegram_id,
  username,
  subscription_status,
  subscription_plan,
  days_left,
  total_llm_requests,
  total_cost_usd,
  requests_today,
  total_meals_logged
FROM users_full_info
LIMIT 10;

