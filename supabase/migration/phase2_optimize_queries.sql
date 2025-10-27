-- ============================================
-- ФАЗА 2: ОПТИМИЗАЦИЯ N+1 ЗАПРОСОВ
-- ============================================
-- Дата: 2025-10-27
-- Описание: Создаём VIEW для получения полного контекста пользователя одним запросом
-- Устраняет проблему N+1 запросов: вместо 4-5 запросов делаем 1
-- ============================================

-- ============================================
-- 1. VIEW: user_full_context
-- ============================================
-- Объединяет все основные таблицы пользователя в одну VIEW

CREATE OR REPLACE VIEW user_full_context AS
SELECT
  -- Основная информация о пользователе
  u.id as user_id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.created_at as user_created_at,

  -- Профиль пользователя
  up.id as profile_id,
  up.name,
  up.age,
  up.gender,
  up.height,
  up.current_weight,
  up.target_weight,
  up.activity_level,
  up.goal,
  up.wishes,
  up.calculation_method,

  -- Активный план питания
  np.id as plan_id,
  np.calories,
  np.protein,
  np.fats,
  np.carbs,
  np.water,
  np.bmr,
  np.tdee,
  np.methodology_explanation,
  np.activity_recommendations,

  -- Подписка пользователя
  us.id as subscription_id,
  us.plan_id as subscription_plan_id,
  us.status as subscription_status,
  us.started_at as subscription_started_at,
  us.expires_at as subscription_expires_at,
  us.is_trial,
  us.is_unlimited

FROM users u
LEFT JOIN user_profiles up ON up.user_id = u.id
LEFT JOIN nutrition_plans np ON np.user_id = u.id AND np.is_active = TRUE
LEFT JOIN user_subscriptions us ON us.user_id = u.id
  AND us.status IN ('trial', 'active')
  AND us.expires_at > NOW()
ORDER BY u.id;

-- ============================================
-- 2. ФУНКЦИЯ: get_user_full_context
-- ============================================
-- Получает полный контекст пользователя по telegram_id одним запросом

CREATE OR REPLACE FUNCTION get_user_full_context(
  p_telegram_id BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_context JSONB;
BEGIN
  SELECT jsonb_build_object(
    -- User info
    'user', jsonb_build_object(
      'id', user_id,
      'telegram_id', telegram_id,
      'username', username,
      'first_name', first_name,
      'created_at', user_created_at
    ),

    -- Profile
    'profile', CASE
      WHEN profile_id IS NOT NULL THEN jsonb_build_object(
        'id', profile_id,
        'name', name,
        'age', age,
        'gender', gender,
        'height', height,
        'current_weight', current_weight,
        'target_weight', target_weight,
        'activity_level', activity_level,
        'goal', goal,
        'wishes', wishes,
        'calculation_method', calculation_method
      )
      ELSE NULL
    END,

    -- Nutrition plan
    'plan', CASE
      WHEN plan_id IS NOT NULL THEN jsonb_build_object(
        'id', plan_id,
        'calories', calories,
        'protein', protein,
        'fats', fats,
        'carbs', carbs,
        'water', water,
        'bmr', bmr,
        'tdee', tdee,
        'methodology_explanation', methodology_explanation,
        'activity_recommendations', activity_recommendations
      )
      ELSE NULL
    END,

    -- Subscription
    'subscription', CASE
      WHEN subscription_id IS NOT NULL THEN jsonb_build_object(
        'id', subscription_id,
        'plan_id', subscription_plan_id,
        'status', subscription_status,
        'started_at', subscription_started_at,
        'expires_at', subscription_expires_at,
        'is_trial', is_trial,
        'is_unlimited', is_unlimited
      )
      ELSE NULL
    END
  )
  INTO v_context
  FROM user_full_context
  WHERE telegram_id = p_telegram_id;

  RETURN v_context;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. ИНДЕКСЫ (если ещё не созданы)
-- ============================================

-- Убеждаемся что все нужные индексы существуют
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_user_active ON nutrition_plans(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_status ON user_subscriptions(user_id, status, expires_at);
-- CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id); -- Закомментировано: таблица не существует

-- ============================================
-- 4. АЛЬТЕРНАТИВНАЯ ФУНКЦИЯ ДЛЯ user_id
-- ============================================
-- Для случаев когда у нас уже есть user_id (не telegram_id)

CREATE OR REPLACE FUNCTION get_user_full_context_by_id(
  p_user_id BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_context JSONB;
BEGIN
  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', user_id,
      'telegram_id', telegram_id,
      'username', username,
      'first_name', first_name,
      'created_at', user_created_at
    ),
    'profile', CASE
      WHEN profile_id IS NOT NULL THEN jsonb_build_object(
        'id', profile_id,
        'name', name,
        'age', age,
        'gender', gender,
        'height', height,
        'current_weight', current_weight,
        'target_weight', target_weight,
        'activity_level', activity_level,
        'goal', goal,
        'wishes', wishes,
        'calculation_method', calculation_method
      )
      ELSE NULL
    END,
    'plan', CASE
      WHEN plan_id IS NOT NULL THEN jsonb_build_object(
        'id', plan_id,
        'calories', calories,
        'protein', protein,
        'fats', fats,
        'carbs', carbs,
        'water', water,
        'bmr', bmr,
        'tdee', tdee,
        'methodology_explanation', methodology_explanation,
        'activity_recommendations', activity_recommendations
      )
      ELSE NULL
    END,
    'subscription', CASE
      WHEN subscription_id IS NOT NULL THEN jsonb_build_object(
        'id', subscription_id,
        'plan_id', subscription_plan_id,
        'status', subscription_status,
        'started_at', subscription_started_at,
        'expires_at', subscription_expires_at,
        'is_trial', is_trial,
        'is_unlimited', is_unlimited
      )
      ELSE NULL
    END
  )
  INTO v_context
  FROM user_full_context
  WHERE user_id = p_user_id;

  RETURN v_context;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. КОММЕНТАРИИ
-- ============================================

COMMENT ON VIEW user_full_context IS 'VIEW для получения полного контекста пользователя одним запросом. Устраняет N+1 проблему.';
COMMENT ON FUNCTION get_user_full_context IS 'Получает полный контекст пользователя по telegram_id в формате JSONB. Использует view user_full_context.';
COMMENT ON FUNCTION get_user_full_context_by_id IS 'Получает полный контекст пользователя по user_id в формате JSONB. Использует view user_full_context.';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
-- Примеры использования:
--
-- 1. Через VIEW (если нужны конкретные поля):
-- SELECT * FROM user_full_context WHERE telegram_id = 123456789;
--
-- 2. Через функцию (получаем всё как JSONB):
-- SELECT get_user_full_context(123456789);
--
-- 3. Через функцию по user_id:
-- SELECT get_user_full_context_by_id(42);
--
-- 4. Проверка производительности:
-- EXPLAIN ANALYZE SELECT get_user_full_context(123456789);
--
-- ПРИМЕЧАНИЕ: user_preferences НЕ включены в VIEW для совместимости.
-- В коде бота уже есть отдельная функция getUserPreferences() для этого.
-- ============================================
