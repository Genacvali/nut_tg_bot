-- ============================================
-- USERS DASHBOARD: Мониторинг пользователей
-- ============================================
-- Дата: 2025-10-28
-- Описание: View для отслеживания активности и статистики пользователей
-- Цель: Видеть кто активен, кто платит, кто churn
-- ============================================

CREATE OR REPLACE VIEW users_dashboard AS
WITH
-- Последняя активность
user_last_activity AS (
  SELECT
    u.id as user_id,
    MAX(GREATEST(
      COALESCE((SELECT MAX(created_at) FROM food_logs WHERE user_id = u.id), '1970-01-01'::timestamptz),
      COALESCE((SELECT MAX(created_at) FROM water_logs WHERE user_id = u.id), '1970-01-01'::timestamptz),
      COALESCE((SELECT MAX(created_at) FROM weight_logs WHERE user_id = u.id), '1970-01-01'::timestamptz)
    )) as last_active_at
  FROM users u
  GROUP BY u.id
),

-- Статистика активности за последние 7 и 30 дней
user_activity_stats AS (
  SELECT
    user_id,
    COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as logs_7d,
    COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as logs_30d,
    COUNT(*) as total_logs
  FROM (
    SELECT user_id, created_at FROM food_logs
    UNION ALL
    SELECT user_id, created_at FROM water_logs
  ) all_logs
  GROUP BY user_id
),

-- Подписка
user_subscription_info AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    plan_name,
    is_trial,
    is_unlimited,
    expires_at,
    CASE
      WHEN is_unlimited THEN 'unlimited'
      WHEN expires_at > NOW() AND is_trial THEN 'trial'
      WHEN expires_at > NOW() AND NOT is_trial THEN 'paid'
      WHEN expires_at <= NOW() THEN 'expired'
      ELSE 'none'
    END as subscription_status,
    CASE
      WHEN expires_at > NOW() THEN EXTRACT(DAY FROM (expires_at - NOW()))::INT
      ELSE 0
    END as days_left
  FROM user_subscriptions
  ORDER BY user_id, created_at DESC
),

-- Streak информация
user_streak_info AS (
  SELECT
    user_id,
    current_streak,
    longest_streak
  FROM user_streaks
)

SELECT
  -- Основная информация
  u.id as user_id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.created_at as registered_at,
  EXTRACT(DAY FROM (NOW() - u.created_at))::INT as days_since_registration,

  -- Профиль
  up.name as profile_name,
  up.age,
  up.gender,
  up.current_weight,
  up.goal,

  -- Подписка
  COALESCE(usi.subscription_status, 'none') as subscription_status,
  usi.plan_name,
  usi.is_trial,
  usi.is_unlimited,
  usi.expires_at as subscription_expires_at,
  usi.days_left as subscription_days_left,

  -- Активность
  ula.last_active_at,
  EXTRACT(DAY FROM (NOW() - COALESCE(ula.last_active_at, u.created_at)))::INT as days_inactive,

  -- Классификация активности
  CASE
    WHEN ula.last_active_at IS NULL THEN 'never_active'
    WHEN ula.last_active_at >= NOW() - INTERVAL '1 day' THEN 'active_today'
    WHEN ula.last_active_at >= NOW() - INTERVAL '3 days' THEN 'active_3d'
    WHEN ula.last_active_at >= NOW() - INTERVAL '7 days' THEN 'active_7d'
    WHEN ula.last_active_at >= NOW() - INTERVAL '30 days' THEN 'active_30d'
    ELSE 'inactive'
  END as activity_status,

  -- Статистика логирования
  COALESCE(uas.logs_7d, 0) as logs_last_7_days,
  COALESCE(uas.logs_30d, 0) as logs_last_30_days,
  COALESCE(uas.total_logs, 0) as total_logs,

  -- Средняя активность (логов в день)
  CASE
    WHEN EXTRACT(DAY FROM (NOW() - u.created_at))::INT > 0
    THEN ROUND(COALESCE(uas.total_logs, 0)::NUMERIC / EXTRACT(DAY FROM (NOW() - u.created_at))::NUMERIC, 2)
    ELSE 0
  END as avg_logs_per_day,

  -- Streak
  COALESCE(usr.current_streak, 0) as current_streak,
  COALESCE(usr.longest_streak, 0) as longest_streak,

  -- Флаги для быстрого анализа
  CASE WHEN ula.last_active_at >= NOW() - INTERVAL '7 days' THEN TRUE ELSE FALSE END as is_active_user,
  CASE WHEN COALESCE(uas.logs_7d, 0) = 0 AND EXTRACT(DAY FROM (NOW() - u.created_at))::INT > 7 THEN TRUE ELSE FALSE END as is_churned,
  CASE WHEN usi.subscription_status = 'paid' THEN TRUE ELSE FALSE END as is_paying_user,
  CASE WHEN usi.subscription_status IN ('trial', 'paid', 'unlimited') THEN TRUE ELSE FALSE END as has_active_subscription,
  CASE WHEN usi.subscription_status = 'trial' AND usi.days_left <= 2 THEN TRUE ELSE FALSE END as trial_ending_soon

FROM users u
LEFT JOIN user_profiles up ON u.id = up.user_id
LEFT JOIN user_last_activity ula ON u.id = ula.user_id
LEFT JOIN user_activity_stats uas ON u.id = uas.user_id
LEFT JOIN user_subscription_info usi ON u.id = usi.user_id
LEFT JOIN user_streak_info usr ON u.id = usr.user_id

ORDER BY u.created_at DESC;

-- ============================================
-- КОММЕНТАРИИ
-- ============================================

COMMENT ON VIEW users_dashboard IS 'Дашборд для мониторинга пользователей: активность, подписки, статистика';

-- ============================================
-- ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ
-- ============================================

-- Индексы уже должны быть созданы в основных таблицах, но проверим критичные:

-- Для быстрого поиска последней активности
CREATE INDEX IF NOT EXISTS idx_food_logs_user_created ON food_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_water_logs_user_created ON water_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_created ON weight_logs(user_id, created_at DESC);

-- Для подписок
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_created ON user_subscriptions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires ON user_subscriptions(expires_at);

-- ============================================
-- ПРИМЕРЫ ЗАПРОСОВ
-- ============================================

-- 1. Активные платящие пользователи
-- SELECT * FROM users_dashboard
-- WHERE is_active_user = TRUE AND is_paying_user = TRUE
-- ORDER BY logs_last_7_days DESC;

-- 2. Пользователи с истекающим trial
-- SELECT * FROM users_dashboard
-- WHERE trial_ending_soon = TRUE
-- ORDER BY subscription_days_left ASC;

-- 3. Churned пользователи (давно не логируют)
-- SELECT * FROM users_dashboard
-- WHERE is_churned = TRUE
-- ORDER BY days_inactive DESC;

-- 4. Топ активных пользователей
-- SELECT username, first_name, logs_last_7_days, current_streak, subscription_status
-- FROM users_dashboard
-- WHERE is_active_user = TRUE
-- ORDER BY logs_last_7_days DESC
-- LIMIT 10;

-- 5. Статистика по статусам подписок
-- SELECT
--   subscription_status,
--   COUNT(*) as users_count,
--   COUNT(CASE WHEN is_active_user THEN 1 END) as active_count,
--   ROUND(AVG(logs_last_7_days), 2) as avg_logs_7d
-- FROM users_dashboard
-- GROUP BY subscription_status
-- ORDER BY users_count DESC;

-- 6. Конверсия из trial в paid
-- SELECT
--   COUNT(CASE WHEN subscription_status = 'trial' THEN 1 END) as trial_users,
--   COUNT(CASE WHEN subscription_status = 'paid' THEN 1 END) as paid_users,
--   ROUND(
--     COUNT(CASE WHEN subscription_status = 'paid' THEN 1 END)::NUMERIC /
--     NULLIF(COUNT(CASE WHEN subscription_status IN ('trial', 'paid', 'expired') THEN 1 END), 0) * 100,
--     2
--   ) as conversion_rate_percent
-- FROM users_dashboard;

-- ============================================
