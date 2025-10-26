-- ============================================
-- ФУНКЦИИ ДЛЯ АДМИНСКОГО БОТА
-- ============================================
-- Вспомогательные функции для быстрого получения статистики
-- ============================================

-- Функция для получения статистики подписок
CREATE OR REPLACE FUNCTION get_admin_subscription_stats()
RETURNS TABLE (
  status TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN us.is_unlimited THEN 'unlimited'
      WHEN us.status = 'active' AND us.expires_at > NOW() THEN 'active'
      WHEN us.status = 'trial' AND us.expires_at > NOW() THEN 'trial'
      ELSE 'expired'
    END as status,
    COUNT(*) as count
  FROM user_subscriptions us
  GROUP BY 
    CASE 
      WHEN us.is_unlimited THEN 'unlimited'
      WHEN us.status = 'active' AND us.expires_at > NOW() THEN 'active'
      WHEN us.status = 'trial' AND us.expires_at > NOW() THEN 'trial'
      ELSE 'expired'
    END;
END;
$$ LANGUAGE plpgsql;

-- Функция для поиска пользователя по telegram_id или username
CREATE OR REPLACE FUNCTION search_user(search_term TEXT)
RETURNS TABLE (
  user_id BIGINT,
  telegram_id BIGINT,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ,
  subscription_status TEXT,
  subscription_expires_at TIMESTAMPTZ,
  is_unlimited BOOLEAN,
  total_payments BIGINT,
  total_paid_rub NUMERIC,
  llm_requests INTEGER,
  llm_cost_usd NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.telegram_id,
    u.username,
    u.first_name,
    u.created_at,
    us.status,
    us.expires_at,
    us.is_unlimited,
    (SELECT COUNT(*) FROM payment_intents WHERE user_id = u.id AND status = 'CONFIRMED'),
    (SELECT COALESCE(SUM(amount_rub), 0) FROM payment_intents WHERE user_id = u.id AND status = 'CONFIRMED'),
    u.llm_requests_count,
    u.total_cost_usd
  FROM users u
  LEFT JOIN user_subscriptions us ON us.user_id = u.id
  WHERE 
    u.telegram_id::TEXT = search_term
    OR u.username ILIKE '%' || search_term || '%'
    OR u.first_name ILIKE '%' || search_term || '%'
  ORDER BY u.created_at DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- Функция для получения детальной информации о пользователе
CREATE OR REPLACE FUNCTION get_user_details(p_telegram_id BIGINT)
RETURNS TABLE (
  user_id BIGINT,
  telegram_id BIGINT,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ,
  
  -- Подписка
  subscription_status TEXT,
  subscription_expires_at TIMESTAMPTZ,
  subscription_days_left INTEGER,
  is_unlimited BOOLEAN,
  
  -- Активность
  total_food_logs BIGINT,
  last_activity TIMESTAMPTZ,
  
  -- Платежи
  total_payments BIGINT,
  total_paid_rub NUMERIC,
  last_payment_date TIMESTAMPTZ,
  
  -- LLM
  llm_requests INTEGER,
  llm_total_cost_usd NUMERIC,
  llm_cost_today NUMERIC,
  
  -- Профиль
  has_profile BOOLEAN,
  profile_goal TEXT,
  profile_age INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.telegram_id,
    u.username,
    u.first_name,
    u.created_at,
    
    -- Подписка
    us.status,
    us.expires_at,
    CASE 
      WHEN us.is_unlimited THEN 999999
      WHEN us.expires_at > NOW() THEN EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER
      ELSE 0
    END,
    us.is_unlimited,
    
    -- Активность
    (SELECT COUNT(*) FROM food_logs WHERE user_id = u.id),
    (SELECT MAX(created_at) FROM food_logs WHERE user_id = u.id),
    
    -- Платежи
    (SELECT COUNT(*) FROM payment_intents WHERE user_id = u.id AND status = 'CONFIRMED'),
    (SELECT COALESCE(SUM(amount_rub), 0) FROM payment_intents WHERE user_id = u.id AND status = 'CONFIRMED'),
    (SELECT MAX(created_at) FROM payment_intents WHERE user_id = u.id AND status = 'CONFIRMED'),
    
    -- LLM
    u.llm_requests_count,
    u.total_cost_usd,
    u.cost_today,
    
    -- Профиль
    (SELECT COUNT(*) > 0 FROM user_profiles WHERE user_id = u.id),
    (SELECT goal FROM user_profiles WHERE user_id = u.id LIMIT 1),
    (SELECT age FROM user_profiles WHERE user_id = u.id LIMIT 1)
    
  FROM users u
  LEFT JOIN user_subscriptions us ON us.user_id = u.id
  WHERE u.telegram_id = p_telegram_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Функция для получения топ пользователей по активности
CREATE OR REPLACE FUNCTION get_top_active_users(days INTEGER DEFAULT 30, limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
  user_id BIGINT,
  telegram_id BIGINT,
  username TEXT,
  first_name TEXT,
  activity_count BIGINT,
  last_activity TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.telegram_id,
    u.username,
    u.first_name,
    COUNT(fl.id) as activity_count,
    MAX(fl.created_at) as last_activity
  FROM users u
  INNER JOIN food_logs fl ON fl.user_id = u.id
  WHERE fl.created_at >= NOW() - (days || ' days')::INTERVAL
  GROUP BY u.id, u.telegram_id, u.username, u.first_name
  ORDER BY activity_count DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Функция для получения статистики по периодам
CREATE OR REPLACE FUNCTION get_period_stats(period_days INTEGER DEFAULT 7)
RETURNS TABLE (
  new_users BIGINT,
  new_subscriptions BIGINT,
  total_payments BIGINT,
  revenue_rub NUMERIC,
  active_users BIGINT,
  food_logs_count BIGINT
) AS $$
DECLARE
  start_date TIMESTAMPTZ;
BEGIN
  start_date := NOW() - (period_days || ' days')::INTERVAL;
  
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM users WHERE created_at >= start_date),
    (SELECT COUNT(*) FROM user_subscriptions WHERE started_at >= start_date),
    (SELECT COUNT(*) FROM payment_intents WHERE status = 'CONFIRMED' AND created_at >= start_date),
    (SELECT COALESCE(SUM(amount_rub), 0) FROM payment_intents WHERE status = 'CONFIRMED' AND created_at >= start_date),
    (SELECT COUNT(DISTINCT user_id) FROM food_logs WHERE created_at >= start_date),
    (SELECT COUNT(*) FROM food_logs WHERE created_at >= start_date);
END;
$$ LANGUAGE plpgsql;

-- Комментарии
COMMENT ON FUNCTION get_admin_subscription_stats IS 'Получить статистику подписок для админ-панели';
COMMENT ON FUNCTION search_user IS 'Поиск пользователя по telegram_id, username или имени';
COMMENT ON FUNCTION get_user_details IS 'Получить детальную информацию о пользователе';
COMMENT ON FUNCTION get_top_active_users IS 'Получить топ активных пользователей за период';
COMMENT ON FUNCTION get_period_stats IS 'Получить статистику за период';

