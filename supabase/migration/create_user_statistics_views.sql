-- ============================================
-- СИСТЕМА МОНИТОРИНГА АКТИВНЫХ ПОЛЬЗОВАТЕЛЕЙ
-- Comprehensive views для статистики и аналитики
-- ============================================

-- ===========================================
-- 1. ГЛАВНАЯ VIEW - ПОЛНАЯ СТАТИСТИКА ПОЛЬЗОВАТЕЛЕЙ
-- ===========================================
CREATE OR REPLACE VIEW user_statistics AS
SELECT
  u.id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.created_at as registered_at,

  -- Подписка
  us.status as subscription_status,
  us.is_trial,
  us.is_unlimited,
  sp.name as plan_name,
  us.started_at as subscription_started,
  us.expires_at as subscription_expires,
  CASE
    WHEN us.expires_at < NOW() THEN 'expired'
    WHEN us.expires_at > NOW() AND us.expires_at < NOW() + INTERVAL '3 days' THEN 'expires_soon'
    WHEN us.is_unlimited THEN 'unlimited'
    ELSE 'active'
  END as subscription_health,
  EXTRACT(DAYS FROM (us.expires_at - NOW())) as days_until_expiry,

  -- Профиль
  up.age,
  up.gender,
  up.goal,
  up.activity_level,
  up.current_weight,
  up.target_weight,

  -- Активность по еде
  COALESCE(fl.total_food_logs, 0) as total_food_logs,
  fl.last_food_log_at,
  COALESCE(fl.logs_last_7_days, 0) as logs_last_7_days,
  COALESCE(fl.logs_last_30_days, 0) as logs_last_30_days,

  -- LLM Usage
  u.total_tokens_used,
  u.total_cost_usd,
  u.llm_requests_count,
  u.requests_today,
  u.cost_today,
  u.last_llm_request_at,

  -- Метрики активности
  CASE
    WHEN u.last_llm_request_at > NOW() - INTERVAL '1 day' THEN 'active_today'
    WHEN u.last_llm_request_at > NOW() - INTERVAL '3 days' THEN 'active_3days'
    WHEN u.last_llm_request_at > NOW() - INTERVAL '7 days' THEN 'active_week'
    WHEN u.last_llm_request_at IS NULL THEN 'never_used'
    ELSE 'inactive'
  END as activity_status,

  -- Качество пользователя (engagement score)
  CASE
    WHEN COALESCE(fl.logs_last_7_days, 0) >= 5 AND u.requests_today > 0 THEN 'high'
    WHEN COALESCE(fl.logs_last_7_days, 0) >= 2 OR u.llm_requests_count > 10 THEN 'medium'
    WHEN u.llm_requests_count > 0 THEN 'low'
    ELSE 'inactive'
  END as engagement_level,

  -- Временные метрики
  EXTRACT(DAYS FROM (NOW() - u.created_at)) as days_since_registration,
  EXTRACT(DAYS FROM (NOW() - u.last_llm_request_at)) as days_since_last_activity

FROM users u
LEFT JOIN user_subscriptions us ON u.id = us.user_id
  AND us.status IN ('trial', 'active')
LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
LEFT JOIN user_profiles up ON u.id = up.user_id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) as total_food_logs,
    MAX(logged_at) as last_food_log_at,
    COUNT(CASE WHEN logged_at > NOW() - INTERVAL '7 days' THEN 1 END) as logs_last_7_days,
    COUNT(CASE WHEN logged_at > NOW() - INTERVAL '30 days' THEN 1 END) as logs_last_30_days
  FROM food_logs
  GROUP BY user_id
) fl ON u.id = fl.user_id
ORDER BY u.last_llm_request_at DESC NULLS LAST;

COMMENT ON VIEW user_statistics IS 'Полная статистика всех пользователей с подписками, активностью и engagement метриками';


-- ===========================================
-- 2. АКТИВНЫЕ ПОЛЬЗОВАТЕЛИ (последние 7 дней)
-- ===========================================
CREATE OR REPLACE VIEW active_users_7d AS
SELECT
  us.*
FROM user_statistics us
WHERE
  us.activity_status IN ('active_today', 'active_3days', 'active_week')
  OR us.subscription_status IN ('trial', 'active')
ORDER BY us.last_llm_request_at DESC NULLS LAST;

COMMENT ON VIEW active_users_7d IS 'Пользователи, активные за последние 7 дней или с активной подпиской';


-- ===========================================
-- 3. ПОЛЬЗОВАТЕЛИ С ВЫСОКИМ ENGAGEMENT
-- ===========================================
CREATE OR REPLACE VIEW high_engagement_users AS
SELECT
  us.*
FROM user_statistics us
WHERE
  us.engagement_level = 'high'
  OR (us.logs_last_7_days >= 5 AND us.llm_requests_count > 10)
ORDER BY us.logs_last_7_days DESC, us.llm_requests_count DESC;

COMMENT ON VIEW high_engagement_users IS 'Пользователи с высоким уровнем вовлеченности';


-- ===========================================
-- 4. ПОЛЬЗОВАТЕЛИ В РИСКЕ (CHURN RISK)
-- ===========================================
CREATE OR REPLACE VIEW churn_risk_users AS
SELECT
  us.*,
  CASE
    WHEN us.subscription_health = 'expires_soon' THEN 'subscription_expiring'
    WHEN us.activity_status = 'inactive' AND us.subscription_status = 'active' THEN 'paid_but_inactive'
    WHEN us.is_trial AND us.days_until_expiry <= 2 AND us.logs_last_7_days < 3 THEN 'trial_low_engagement'
    WHEN us.days_since_last_activity > 3 AND us.subscription_status = 'trial' THEN 'trial_abandoned'
    ELSE 'other'
  END as churn_reason
FROM user_statistics us
WHERE
  (us.subscription_health = 'expires_soon' AND NOT us.is_unlimited)
  OR (us.activity_status = 'inactive' AND us.subscription_status IN ('trial', 'active'))
  OR (us.is_trial AND us.days_until_expiry <= 2 AND us.logs_last_7_days < 3)
  OR (us.days_since_last_activity > 3 AND us.subscription_status = 'trial')
ORDER BY
  CASE us.subscription_status
    WHEN 'active' THEN 1
    WHEN 'trial' THEN 2
    ELSE 3
  END,
  us.days_until_expiry ASC NULLS LAST;

COMMENT ON VIEW churn_risk_users IS 'Пользователи в риске ухода (churn): истекающие подписки, низкая активность, abandoned trials';


-- ===========================================
-- 5. НОВЫЕ ПОЛЬЗОВАТЕЛИ (последние 3 дня)
-- ===========================================
CREATE OR REPLACE VIEW new_users_3d AS
SELECT
  us.*
FROM user_statistics us
WHERE
  us.days_since_registration <= 3
ORDER BY us.registered_at DESC;

COMMENT ON VIEW new_users_3d IS 'Пользователи, зарегистрированные за последние 3 дня';


-- ===========================================
-- 6. ПОЛЬЗОВАТЕЛИ БЕЗ ПРОФИЛЯ
-- ===========================================
CREATE OR REPLACE VIEW users_without_profile AS
SELECT
  us.*
FROM user_statistics us
WHERE
  us.age IS NULL
  AND us.days_since_registration > 0
ORDER BY us.registered_at DESC;

COMMENT ON VIEW users_without_profile IS 'Пользователи, которые не завершили создание профиля';


-- ===========================================
-- 7. СТАТИСТИКА ПО ПОДПИСКАМ (СВОДНАЯ)
-- ===========================================
CREATE OR REPLACE VIEW subscription_summary AS
SELECT
  subscription_status,
  plan_name,
  is_trial,
  is_unlimited,
  COUNT(*) as user_count,
  COUNT(CASE WHEN activity_status IN ('active_today', 'active_3days') THEN 1 END) as active_users,
  AVG(llm_requests_count) as avg_requests_per_user,
  AVG(total_food_logs) as avg_food_logs_per_user,
  AVG(logs_last_7_days) as avg_logs_last_7days,
  SUM(total_cost_usd) as total_cost_usd,
  AVG(days_since_registration) as avg_days_since_registration
FROM user_statistics
GROUP BY subscription_status, plan_name, is_trial, is_unlimited
ORDER BY user_count DESC;

COMMENT ON VIEW subscription_summary IS 'Сводная статистика по типам подписок';


-- ===========================================
-- 8. ДЕМОГРАФИЧЕСКАЯ СТАТИСТИКА
-- ===========================================
CREATE OR REPLACE VIEW demographic_stats AS
SELECT
  gender,
  goal,
  activity_level,
  COUNT(*) as user_count,
  AVG(age) as avg_age,
  AVG(logs_last_7_days) as avg_logs_last_7days,
  COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as paid_users,
  COUNT(CASE WHEN engagement_level = 'high' THEN 1 END) as high_engagement_users
FROM user_statistics
WHERE age IS NOT NULL
GROUP BY gender, goal, activity_level
ORDER BY user_count DESC;

COMMENT ON VIEW demographic_stats IS 'Статистика по демографическим характеристикам пользователей';


-- ===========================================
-- ФУНКЦИИ ДЛЯ БЫСТРОГО ДОСТУПА К СТАТИСТИКЕ
-- ===========================================

-- Функция: Общая статистика пользователей
CREATE OR REPLACE FUNCTION get_overall_statistics()
RETURNS TABLE (
  metric_name TEXT,
  metric_value NUMERIC
)
LANGUAGE sql
AS $$
  SELECT 'total_users' as metric_name, COUNT(*)::NUMERIC as metric_value FROM users
  UNION ALL
  SELECT 'active_users_today', COUNT(*)::NUMERIC FROM user_statistics WHERE activity_status = 'active_today'
  UNION ALL
  SELECT 'active_users_7d', COUNT(*)::NUMERIC FROM user_statistics WHERE activity_status IN ('active_today', 'active_3days', 'active_week')
  UNION ALL
  SELECT 'trial_users', COUNT(*)::NUMERIC FROM user_statistics WHERE is_trial = TRUE AND subscription_status = 'trial'
  UNION ALL
  SELECT 'paid_users', COUNT(*)::NUMERIC FROM user_statistics WHERE is_trial = FALSE AND subscription_status = 'active'
  UNION ALL
  SELECT 'unlimited_users', COUNT(*)::NUMERIC FROM user_statistics WHERE is_unlimited = TRUE
  UNION ALL
  SELECT 'high_engagement_users', COUNT(*)::NUMERIC FROM user_statistics WHERE engagement_level = 'high'
  UNION ALL
  SELECT 'churn_risk_users', COUNT(*)::NUMERIC FROM churn_risk_users
  UNION ALL
  SELECT 'users_without_profile', COUNT(*)::NUMERIC FROM users_without_profile
  UNION ALL
  SELECT 'total_food_logs', SUM(total_food_logs)::NUMERIC FROM user_statistics
  UNION ALL
  SELECT 'total_llm_requests', SUM(llm_requests_count)::NUMERIC FROM user_statistics
  UNION ALL
  SELECT 'total_cost_usd', ROUND(SUM(total_cost_usd)::NUMERIC, 2) FROM user_statistics
  UNION ALL
  SELECT 'avg_cost_per_user', ROUND(AVG(total_cost_usd)::NUMERIC, 4) FROM user_statistics WHERE total_cost_usd > 0;
$$;

COMMENT ON FUNCTION get_overall_statistics IS 'Возвращает ключевые метрики по всем пользователям';


-- Функция: Детальная информация о пользователе
DROP FUNCTION IF EXISTS get_user_details(BIGINT);
CREATE OR REPLACE FUNCTION get_user_details(p_telegram_id BIGINT)
RETURNS TABLE (
  user_info JSONB,
  subscription_info JSONB,
  profile_info JSONB,
  activity_info JSONB,
  llm_usage_info JSONB
)
LANGUAGE sql
AS $$
  SELECT
    jsonb_build_object(
      'id', us.id,
      'telegram_id', us.telegram_id,
      'username', us.username,
      'first_name', us.first_name,
      'registered_at', us.registered_at,
      'days_since_registration', us.days_since_registration
    ) as user_info,

    jsonb_build_object(
      'status', us.subscription_status,
      'plan_name', us.plan_name,
      'is_trial', us.is_trial,
      'is_unlimited', us.is_unlimited,
      'started_at', us.subscription_started,
      'expires_at', us.subscription_expires,
      'days_until_expiry', us.days_until_expiry,
      'subscription_health', us.subscription_health
    ) as subscription_info,

    jsonb_build_object(
      'age', us.age,
      'gender', us.gender,
      'goal', us.goal,
      'activity_level', us.activity_level,
      'current_weight', us.current_weight,
      'target_weight', us.target_weight
    ) as profile_info,

    jsonb_build_object(
      'activity_status', us.activity_status,
      'engagement_level', us.engagement_level,
      'total_food_logs', us.total_food_logs,
      'logs_last_7_days', us.logs_last_7_days,
      'logs_last_30_days', us.logs_last_30_days,
      'last_food_log_at', us.last_food_log_at,
      'days_since_last_activity', us.days_since_last_activity
    ) as activity_info,

    jsonb_build_object(
      'total_requests', us.llm_requests_count,
      'requests_today', us.requests_today,
      'total_tokens', us.total_tokens_used,
      'total_cost_usd', us.total_cost_usd,
      'cost_today', us.cost_today,
      'last_request_at', us.last_llm_request_at
    ) as llm_usage_info

  FROM user_statistics us
  WHERE us.telegram_id = p_telegram_id;
$$;

COMMENT ON FUNCTION get_user_details IS 'Возвращает детальную информацию о пользователе по telegram_id';


-- ===========================================
-- ПРИМЕРЫ ПОЛЕЗНЫХ ЗАПРОСОВ
-- ===========================================

-- Все активные пользователи с полной информацией
-- SELECT * FROM user_statistics WHERE subscription_status IN ('trial', 'active') ORDER BY last_llm_request_at DESC;

-- Топ-20 самых активных пользователей
-- SELECT telegram_id, username, logs_last_7_days, llm_requests_count, engagement_level
-- FROM user_statistics
-- ORDER BY logs_last_7_days DESC, llm_requests_count DESC
-- LIMIT 20;

-- Пользователи в риске
-- SELECT * FROM churn_risk_users;

-- Общая статистика
-- SELECT * FROM get_overall_statistics();

-- Детали конкретного пользователя
-- SELECT * FROM get_user_details(577449647);

-- Статистика по подпискам
-- SELECT * FROM subscription_summary;

-- Демографическая статистика
-- SELECT * FROM demographic_stats;

-- Пользователи без активности после регистрации
-- SELECT * FROM user_statistics
-- WHERE llm_requests_count = 0 AND days_since_registration > 1
-- ORDER BY registered_at DESC;

-- Конверсия trial -> paid
-- SELECT
--   COUNT(CASE WHEN is_trial THEN 1 END) as trial_users,
--   COUNT(CASE WHEN NOT is_trial AND subscription_status = 'active' THEN 1 END) as paid_users,
--   ROUND(
--     COUNT(CASE WHEN NOT is_trial AND subscription_status = 'active' THEN 1 END)::NUMERIC /
--     NULLIF(COUNT(*), 0) * 100,
--     2
--   ) as conversion_rate_percent
-- FROM user_statistics
-- WHERE subscription_status IN ('trial', 'active');

