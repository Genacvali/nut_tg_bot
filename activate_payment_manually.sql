-- ============================================
-- РУЧНАЯ АКТИВАЦИЯ ПЛАТЕЖА
-- ============================================
-- Использовать, если платеж прошёл, но webhook не сработал
-- ============================================

-- 1. Обновляем статус payment_intent
UPDATE payment_intents
SET status = 'CONFIRMED'
WHERE order_id = '16_2_1761383572235';

-- 2. Деактивируем старую trial подписку
UPDATE user_subscriptions
SET status = 'expired'
WHERE user_id = (SELECT id FROM users WHERE telegram_id = 148767610)
  AND is_trial = true;

-- 3. Создаём новую активную подписку
INSERT INTO user_subscriptions (
  user_id,
  plan_id,
  started_at,
  expires_at,
  status,
  is_trial,
  is_unlimited,
  granted_by_admin_id
)
SELECT 
  u.id,
  (SELECT id FROM subscription_plans WHERE name = 'monthly'),
  NOW(),
  NOW() + INTERVAL '30 days',
  'active',
  false,
  false,
  NULL
FROM users u
WHERE u.telegram_id = 148767610
ON CONFLICT DO NOTHING;

-- 4. Проверяем результат
SELECT 
  u.telegram_id,
  u.first_name,
  us.status,
  us.started_at,
  us.expires_at,
  sp.name as plan_name,
  EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER as days_left
FROM user_subscriptions us
JOIN users u ON us.user_id = u.id
JOIN subscription_plans sp ON us.plan_id = sp.id
WHERE u.telegram_id = 148767610
  AND us.status = 'active';

