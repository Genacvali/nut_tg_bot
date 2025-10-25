-- ============================================
-- ПРОВЕРКА РАННИХ ПОЛЬЗОВАТЕЛЕЙ
-- ============================================
-- Этот скрипт показывает список пользователей без подписки
-- НИЧЕГО НЕ МЕНЯЕТ - только показывает информацию
-- ============================================

-- Показываем пользователей без подписки или с trial подпиской
SELECT 
  u.id,
  u.telegram_id,
  u.username,
  u.first_name,
  u.created_at as "Дата регистрации",
  COALESCE(us.is_trial, false) as "Trial подписка",
  COALESCE(us.is_unlimited, false) as "Безлимитная подписка",
  us.expires_at as "Дата окончания"
FROM users u
LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
ORDER BY u.created_at;

-- Статистика
SELECT 
  '========== СТАТИСТИКА ==========' as info;

SELECT 
  'Всего пользователей' as "Тип",
  COUNT(*) as "Количество"
FROM users
UNION ALL
SELECT 
  'Пользователи без подписки' as "Тип",
  COUNT(*) as "Количество"
FROM users u
LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
WHERE us.id IS NULL
UNION ALL
SELECT 
  'Пользователи с trial' as "Тип",
  COUNT(*) as "Количество"
FROM users u
INNER JOIN user_subscriptions us ON u.id = us.user_id AND us.is_active = true
WHERE us.is_trial = true
UNION ALL
SELECT 
  'Пользователи с unlimited' as "Тип",
  COUNT(*) as "Количество"
FROM users u
INNER JOIN user_subscriptions us ON u.id = us.user_id AND us.is_active = true
WHERE us.is_unlimited = true;

