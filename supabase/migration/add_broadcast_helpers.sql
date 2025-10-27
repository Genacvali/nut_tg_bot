-- ============================================
-- BROADCAST HELPERS: Вспомогательные функции для рассылок
-- ============================================
-- Дата: 2025-10-27
-- Описание: Функции для получения списков пользователей для рассылок
-- ============================================

-- ============================================
-- 1. ФУНКЦИЯ: Получить пользователей с активной подпиской
-- ============================================

CREATE OR REPLACE FUNCTION get_users_with_active_subscription()
RETURNS TABLE(
  id BIGINT,
  telegram_id BIGINT,
  first_name VARCHAR(255)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.telegram_id,
    u.first_name
  FROM users u
  INNER JOIN subscriptions s ON u.id = s.user_id
  WHERE u.telegram_id IS NOT NULL
    AND s.is_active = true
    AND (
      s.status = 'active'
      OR s.status = 'trial'
      OR (s.status = 'unlimited' AND s.expires_at > NOW())
    )
  ORDER BY u.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. ФУНКЦИЯ: Получить статистику пользователей для рассылки
-- ============================================

CREATE OR REPLACE FUNCTION get_broadcast_stats()
RETURNS JSONB AS $$
DECLARE
  v_total_users INT;
  v_active_subscriptions INT;
  v_trial_users INT;
  v_expired_users INT;
BEGIN
  -- Всего пользователей с telegram_id
  SELECT COUNT(*)
  INTO v_total_users
  FROM users
  WHERE telegram_id IS NOT NULL;

  -- Активные подписки
  SELECT COUNT(DISTINCT u.id)
  INTO v_active_subscriptions
  FROM users u
  INNER JOIN subscriptions s ON u.id = s.user_id
  WHERE u.telegram_id IS NOT NULL
    AND s.is_active = true
    AND (s.status = 'active' OR s.status = 'trial' OR s.status = 'unlimited');

  -- Trial пользователи
  SELECT COUNT(DISTINCT u.id)
  INTO v_trial_users
  FROM users u
  INNER JOIN subscriptions s ON u.id = s.user_id
  WHERE u.telegram_id IS NOT NULL
    AND s.is_active = true
    AND s.status = 'trial';

  -- Истекшие подписки
  SELECT COUNT(DISTINCT u.id)
  INTO v_expired_users
  FROM users u
  INNER JOIN subscriptions s ON u.id = s.user_id
  WHERE u.telegram_id IS NOT NULL
    AND s.is_active = false;

  RETURN jsonb_build_object(
    'total_users', v_total_users,
    'active_subscriptions', v_active_subscriptions,
    'trial_users', v_trial_users,
    'expired_users', v_expired_users
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. КОММЕНТАРИИ
-- ============================================

COMMENT ON FUNCTION get_users_with_active_subscription IS 'Возвращает список пользователей с активной подпиской для рассылок';
COMMENT ON FUNCTION get_broadcast_stats IS 'Возвращает статистику пользователей для планирования рассылок';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Получить пользователей с активной подпиской:
-- SELECT * FROM get_users_with_active_subscription();
--
-- 2. Получить статистику:
-- SELECT get_broadcast_stats();
-- ============================================
