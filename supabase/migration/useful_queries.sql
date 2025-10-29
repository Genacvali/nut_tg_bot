-- ============================================
-- ГОТОВЫЕ ЗАПРОСЫ ДЛЯ АНАЛИЗА ПОЛЬЗОВАТЕЛЕЙ
-- Скопируйте и выполните нужный запрос
-- ============================================

-- ===========================================
-- БАЗОВЫЕ ЗАПРОСЫ
-- ===========================================

-- 1. Все активные пользователи (полная информация)
SELECT
  telegram_id,
  username,
  first_name,
  subscription_status,
  plan_name,
  is_trial,
  days_until_expiry,
  logs_last_7_days,
  llm_requests_count,
  engagement_level,
  activity_status,
  last_llm_request_at
FROM user_statistics
WHERE subscription_status IN ('trial', 'active')
ORDER BY last_llm_request_at DESC NULLS LAST;


-- 2. Общая статистика (Dashboard)
SELECT * FROM get_overall_statistics();


-- 3. Топ-20 самых активных пользователей
SELECT
  telegram_id,
  username,
  first_name,
  logs_last_7_days,
  logs_last_30_days,
  llm_requests_count,
  total_cost_usd,
  engagement_level,
  subscription_status
FROM user_statistics
ORDER BY logs_last_7_days DESC, llm_requests_count DESC
LIMIT 20;


-- 4. Детали конкретного пользователя (замените telegram_id)
SELECT * FROM get_user_details(577449647);


-- ===========================================
-- АНАЛИЗ ПОДПИСОК
-- ===========================================

-- 5. Статистика по типам подписок
SELECT * FROM subscription_summary;


-- 6. Пользователи с истекающими подписками (ближайшие 3 дня)
SELECT
  telegram_id,
  username,
  first_name,
  subscription_status,
  plan_name,
  expires_at,
  days_until_expiry,
  logs_last_7_days,
  engagement_level
FROM user_statistics
WHERE
  days_until_expiry IS NOT NULL
  AND days_until_expiry <= 3
  AND NOT is_unlimited
ORDER BY days_until_expiry ASC;


-- 7. Конверсия Trial -> Paid
SELECT
  COUNT(CASE WHEN is_trial THEN 1 END) as trial_users,
  COUNT(CASE WHEN NOT is_trial AND subscription_status = 'active' THEN 1 END) as paid_users,
  ROUND(
    COUNT(CASE WHEN NOT is_trial AND subscription_status = 'active' THEN 1 END)::NUMERIC /
    NULLIF(COUNT(CASE WHEN is_trial THEN 1 END), 0) * 100,
    2
  ) as conversion_rate_percent
FROM user_statistics
WHERE subscription_status IN ('trial', 'active');


-- ===========================================
-- АНАЛИЗ АКТИВНОСТИ И ENGAGEMENT
-- ===========================================

-- 8. Пользователи в риске (Churn Risk)
SELECT
  telegram_id,
  username,
  first_name,
  subscription_status,
  churn_reason,
  days_until_expiry,
  logs_last_7_days,
  days_since_last_activity
FROM churn_risk_users
ORDER BY
  CASE subscription_status
    WHEN 'active' THEN 1
    WHEN 'trial' THEN 2
    ELSE 3
  END,
  days_until_expiry ASC NULLS LAST;


-- 9. Пользователи с высоким engagement
SELECT
  telegram_id,
  username,
  first_name,
  logs_last_7_days,
  llm_requests_count,
  subscription_status,
  plan_name
FROM high_engagement_users
ORDER BY logs_last_7_days DESC;


-- 10. Новые пользователи (последние 3 дня)
SELECT
  telegram_id,
  username,
  first_name,
  registered_at,
  subscription_status,
  logs_last_7_days,
  llm_requests_count,
  activity_status
FROM new_users_3d
ORDER BY registered_at DESC;


-- 11. Пользователи без активности после регистрации
SELECT
  telegram_id,
  username,
  first_name,
  registered_at,
  days_since_registration,
  subscription_status
FROM user_statistics
WHERE
  llm_requests_count = 0
  AND days_since_registration > 1
ORDER BY registered_at DESC;


-- 12. Пользователи без завершенного профиля
SELECT
  telegram_id,
  username,
  first_name,
  registered_at,
  days_since_registration,
  subscription_status
FROM users_without_profile
ORDER BY registered_at DESC;


-- ===========================================
-- ДЕМОГРАФИЧЕСКИЙ АНАЛИЗ
-- ===========================================

-- 13. Демографическая статистика
SELECT * FROM demographic_stats
ORDER BY user_count DESC;


-- 14. Распределение по целям (goal)
SELECT
  goal,
  COUNT(*) as user_count,
  COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as paid_users,
  ROUND(AVG(logs_last_7_days), 2) as avg_logs_per_week,
  ROUND(AVG(age), 1) as avg_age
FROM user_statistics
WHERE goal IS NOT NULL
GROUP BY goal
ORDER BY user_count DESC;


-- 15. Распределение по полу и возрасту
SELECT
  gender,
  COUNT(*) as user_count,
  ROUND(AVG(age), 1) as avg_age,
  MIN(age) as min_age,
  MAX(age) as max_age,
  ROUND(AVG(logs_last_7_days), 2) as avg_weekly_activity
FROM user_statistics
WHERE gender IS NOT NULL
GROUP BY gender;


-- ===========================================
-- АНАЛИЗ LLM USAGE И ЗАТРАТ
-- ===========================================

-- 16. Топ-10 пользователей по расходам на LLM
SELECT
  telegram_id,
  username,
  first_name,
  llm_requests_count,
  total_tokens_used,
  total_cost_usd,
  requests_today,
  cost_today,
  subscription_status
FROM user_statistics
WHERE total_cost_usd > 0
ORDER BY total_cost_usd DESC
LIMIT 10;


-- 17. Средняя стоимость на пользователя по типу подписки
SELECT
  subscription_status,
  plan_name,
  COUNT(*) as user_count,
  ROUND(AVG(total_cost_usd), 4) as avg_cost_per_user,
  ROUND(SUM(total_cost_usd), 2) as total_cost,
  ROUND(AVG(llm_requests_count), 0) as avg_requests_per_user
FROM user_statistics
WHERE subscription_status IN ('trial', 'active')
GROUP BY subscription_status, plan_name
ORDER BY avg_cost_per_user DESC;


-- 18. Пользователи с подозрительной активностью (много запросов сегодня)
SELECT
  telegram_id,
  username,
  first_name,
  requests_today,
  cost_today,
  llm_requests_count,
  total_cost_usd,
  subscription_status
FROM user_statistics
WHERE
  requests_today > 20
  OR cost_today > 1.0
ORDER BY requests_today DESC, cost_today DESC;


-- ===========================================
-- ВРЕМЕННОЙ АНАЛИЗ
-- ===========================================

-- 19. Регистрации по дням (последние 7 дней)
SELECT
  DATE(registered_at) as registration_date,
  COUNT(*) as new_users,
  COUNT(CASE WHEN subscription_status IN ('trial', 'active') THEN 1 END) as users_with_subscription,
  COUNT(CASE WHEN logs_last_7_days > 0 THEN 1 END) as active_users
FROM user_statistics
WHERE registered_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(registered_at)
ORDER BY registration_date DESC;


-- 20. Retention: Активность пользователей по дням после регистрации
SELECT
  CASE
    WHEN days_since_registration = 0 THEN 'Day 0'
    WHEN days_since_registration = 1 THEN 'Day 1'
    WHEN days_since_registration = 2 THEN 'Day 2'
    WHEN days_since_registration BETWEEN 3 AND 7 THEN 'Day 3-7'
    WHEN days_since_registration BETWEEN 8 AND 14 THEN 'Day 8-14'
    WHEN days_since_registration BETWEEN 15 AND 30 THEN 'Day 15-30'
    ELSE 'Day 30+'
  END as cohort,
  COUNT(*) as total_users,
  COUNT(CASE WHEN activity_status IN ('active_today', 'active_3days', 'active_week') THEN 1 END) as active_users,
  ROUND(
    COUNT(CASE WHEN activity_status IN ('active_today', 'active_3days', 'active_week') THEN 1 END)::NUMERIC /
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as retention_percent
FROM user_statistics
GROUP BY
  CASE
    WHEN days_since_registration = 0 THEN 'Day 0'
    WHEN days_since_registration = 1 THEN 'Day 1'
    WHEN days_since_registration = 2 THEN 'Day 2'
    WHEN days_since_registration BETWEEN 3 AND 7 THEN 'Day 3-7'
    WHEN days_since_registration BETWEEN 8 AND 14 THEN 'Day 8-14'
    WHEN days_since_registration BETWEEN 15 AND 30 THEN 'Day 15-30'
    ELSE 'Day 30+'
  END
ORDER BY
  CASE cohort
    WHEN 'Day 0' THEN 1
    WHEN 'Day 1' THEN 2
    WHEN 'Day 2' THEN 3
    WHEN 'Day 3-7' THEN 4
    WHEN 'Day 8-14' THEN 5
    WHEN 'Day 15-30' THEN 6
    ELSE 7
  END;


-- ===========================================
-- CUSTOM ЗАПРОСЫ (ПРИМЕРЫ)
-- ===========================================

-- 21. Найти пользователя по username или telegram_id
SELECT * FROM user_statistics
WHERE
  username ILIKE '%cestgaia%'
  OR telegram_id = 427285473;


-- 22. Пользователи с определенными характеристиками
SELECT
  telegram_id,
  username,
  first_name,
  age,
  gender,
  goal,
  activity_level,
  logs_last_7_days,
  subscription_status
FROM user_statistics
WHERE
  age BETWEEN 25 AND 35
  AND gender = 'female'
  AND goal = 'lose'
  AND subscription_status = 'active'
ORDER BY logs_last_7_days DESC;


-- 23. Активность за последние 24 часа
SELECT
  COUNT(*) as active_users_24h,
  COUNT(CASE WHEN subscription_status = 'trial' THEN 1 END) as trial_users_active,
  COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as paid_users_active,
  SUM(requests_today) as total_requests_today,
  ROUND(SUM(cost_today), 2) as total_cost_today
FROM user_statistics
WHERE last_llm_request_at > NOW() - INTERVAL '24 hours';


-- 24. Пользователи, которым нужно напомнить о подписке
SELECT
  telegram_id,
  username,
  first_name,
  plan_name,
  expires_at,
  days_until_expiry,
  engagement_level
FROM user_statistics
WHERE
  is_trial = TRUE
  AND days_until_expiry BETWEEN 1 AND 2
  AND engagement_level IN ('medium', 'high')
ORDER BY days_until_expiry ASC;


-- 25. Сравнение Trial vs Paid активности
SELECT
  CASE WHEN is_trial THEN 'Trial' ELSE 'Paid' END as user_type,
  COUNT(*) as user_count,
  ROUND(AVG(logs_last_7_days), 2) as avg_logs_per_week,
  ROUND(AVG(llm_requests_count), 0) as avg_total_requests,
  ROUND(AVG(days_since_registration), 1) as avg_days_registered,
  COUNT(CASE WHEN engagement_level = 'high' THEN 1 END) as high_engagement_count
FROM user_statistics
WHERE subscription_status IN ('trial', 'active')
GROUP BY CASE WHEN is_trial THEN 'Trial' ELSE 'Paid' END;


-- ===========================================
-- ЭКСПОРТ ДАННЫХ
-- ===========================================

-- 26. Экспорт всех активных пользователей (для дальнейшего анализа)
SELECT
  telegram_id,
  username,
  first_name,
  registered_at,
  subscription_status,
  plan_name,
  is_trial,
  expires_at,
  age,
  gender,
  goal,
  activity_level,
  total_food_logs,
  logs_last_7_days,
  logs_last_30_days,
  llm_requests_count,
  total_cost_usd,
  engagement_level,
  activity_status
FROM user_statistics
WHERE subscription_status IN ('trial', 'active')
ORDER BY last_llm_request_at DESC;


-- 27. Экспорт для email-маркетинга (активные пользователи с высоким engagement)
SELECT
  telegram_id,
  username,
  first_name,
  subscription_status,
  plan_name,
  days_until_expiry,
  engagement_level
FROM user_statistics
WHERE
  engagement_level IN ('medium', 'high')
  AND subscription_status IN ('trial', 'active')
ORDER BY engagement_level DESC, days_until_expiry ASC;

