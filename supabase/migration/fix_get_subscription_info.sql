-- ============================================
-- FIX: get_subscription_info function
-- ============================================
-- Исправляем типы возвращаемых данных
-- ============================================

DROP FUNCTION IF EXISTS get_subscription_info(bigint);

CREATE OR REPLACE FUNCTION get_subscription_info(p_user_id BIGINT)
RETURNS TABLE (
  plan_id BIGINT,
  plan_name TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_trial BOOLEAN,
  is_unlimited BOOLEAN,
  is_active BOOLEAN,
  needs_payment BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sp.id::BIGINT as plan_id,
    sp.name::TEXT as plan_name,
    us.status::TEXT as status,
    us.started_at,
    us.expires_at,
    us.is_trial,
    us.is_unlimited,
    (us.expires_at > NOW() AND us.status IN ('trial', 'active'))::BOOLEAN as is_active,
    (us.expires_at <= NOW() AND us.status IN ('trial', 'active') AND NOT us.is_unlimited)::BOOLEAN as needs_payment
  FROM user_subscriptions us
  JOIN subscription_plans sp ON us.plan_id = sp.id
  WHERE us.user_id = p_user_id
  ORDER BY us.expires_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Тест функции
SELECT * FROM get_subscription_info(12);

