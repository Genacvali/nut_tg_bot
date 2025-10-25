-- Проверка последних платежей
SELECT 
  pi.id,
  pi.order_id,
  pi.tbank_payment_id,
  pi.status,
  pi.amount_rub,
  pi.created_at,
  pi.error_message,
  u.telegram_id,
  u.first_name,
  sp.name as plan_name
FROM payment_intents pi
JOIN users u ON pi.user_id = u.id
JOIN subscription_plans sp ON pi.plan_id = sp.id
ORDER BY pi.created_at DESC
LIMIT 5;

-- Проверка активных подписок
SELECT 
  us.id,
  u.telegram_id,
  u.first_name,
  us.started_at,
  us.expires_at,
  us.status,
  us.is_trial,
  us.is_unlimited,
  sp.name as plan_name
FROM user_subscriptions us
JOIN users u ON us.user_id = u.id
JOIN subscription_plans sp ON us.plan_id = sp.id
ORDER BY us.created_at DESC
LIMIT 5;

