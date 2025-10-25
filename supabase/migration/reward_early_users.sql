-- ============================================
-- НАГРАДА ДЛЯ РАННИХ ПОЛЬЗОВАТЕЛЕЙ
-- ============================================
-- Выдаём безлимитную подписку пользователям, которые были до системы подписок
-- ============================================

-- Создаём временную таблицу для хранения информации о награждённых пользователях
CREATE TEMP TABLE rewarded_users AS
SELECT 
  u.id as user_id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.created_at
FROM users u
LEFT JOIN user_subscriptions us ON u.id = us.user_id
WHERE 
  -- Пользователи без подписки или с trial подпиской
  (us.id IS NULL OR us.is_trial = true)
  -- Или пользователи созданные до определённой даты (например, до 25 октября 2025)
  -- Раскомментируй следующую строку если нужно фильтровать по дате:
  -- AND u.created_at < '2025-10-25'
ORDER BY u.created_at;

-- Показываем список пользователей которые получат награду
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM rewarded_users;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Найдено ранних пользователей: %', v_count;
  RAISE NOTICE '========================================';
END $$;

-- Деактивируем старые подписки для этих пользователей
UPDATE user_subscriptions
SET is_active = false
WHERE user_id IN (SELECT user_id FROM rewarded_users);

-- Создаём новые безлимитные подписки
INSERT INTO user_subscriptions (
  user_id,
  plan_id,
  started_at,
  expires_at,
  is_active,
  is_trial,
  is_unlimited,
  granted_by_admin_id
)
SELECT 
  ru.user_id,
  (SELECT id FROM subscription_plans WHERE name = 'unlimited' LIMIT 1), -- ID unlimited плана
  NOW(),
  '2099-12-31'::timestamp, -- Дата "навсегда"
  true,
  false,
  true,
  NULL -- Можно указать ID админа если нужно
FROM rewarded_users ru
ON CONFLICT DO NOTHING;

-- Логируем результат
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM rewarded_users;
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Безлимитные подписки выданы: % пользователям', v_count;
  RAISE NOTICE '========================================';
END $$;

-- Показываем список награждённых пользователей
SELECT 
  telegram_id,
  username,
  first_name,
  created_at
FROM rewarded_users
ORDER BY created_at;

-- Комментарий
COMMENT ON TABLE user_subscriptions IS 'Unlimited подписки выданы ранним пользователям за тестирование продукта';

