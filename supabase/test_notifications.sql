-- ========================================
-- ТЕСТИРОВАНИЕ СИСТЕМЫ УВЕДОМЛЕНИЙ
-- Выполните этот SQL в Supabase SQL Editor
-- ========================================

-- Способ 1: Вызвать Edge Function напрямую
-- ⚠️ ЗАМЕНИТЕ YOUR_SERVICE_ROLE_KEY
SELECT
  net.http_post(
    url := 'https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/notification-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  ) AS request_result;

-- ========================================
-- ПРОВЕРКА РЕЗУЛЬТАТОВ
-- ========================================

-- 1. Проверить отправленные уведомления
SELECT 
  nl.*,
  u.telegram_id,
  u.first_name
FROM notification_logs nl
JOIN users u ON nl.user_id = u.id
ORDER BY nl.sent_at DESC
LIMIT 10;

-- 2. Проверить настройки пользователей
SELECT 
  u.first_name,
  u.telegram_id,
  ns.food_notifications_enabled,
  ns.water_notifications_enabled,
  ns.timezone
FROM notification_settings ns
JOIN users u ON ns.user_id = u.id
WHERE ns.food_notifications_enabled = true 
   OR ns.water_notifications_enabled = true;

-- 3. Статистика за последний час
SELECT 
  notification_type,
  COUNT(*) as sent_count,
  MAX(sent_at) as last_sent
FROM notification_logs
WHERE sent_at >= NOW() - INTERVAL '1 hour'
GROUP BY notification_type;

-- ========================================
-- ВРЕМЕННО ВКЛЮЧИТЬ ТЕСТОВЫЙ РЕЖИМ
-- (отправит уведомления всем независимо от времени)
-- ========================================

-- ВНИМАНИЕ: Раскомментируйте только для теста!
-- Это временно отключит проверку времени

/*
-- Сохраняем текущие настройки
CREATE TEMP TABLE backup_settings AS 
SELECT * FROM notification_settings;

-- Устанавливаем время "сейчас" для всех
UPDATE notification_settings
SET 
  food_notification_start_time = (CURRENT_TIME - INTERVAL '1 hour')::TIME,
  food_notification_end_time = (CURRENT_TIME + INTERVAL '1 hour')::TIME,
  water_notification_start_time = (CURRENT_TIME - INTERVAL '1 hour')::TIME,
  water_notification_end_time = (CURRENT_TIME + INTERVAL '1 hour')::TIME;

-- Теперь вызовите функцию (см. выше)

-- Восстановить настройки:
UPDATE notification_settings ns
SET 
  food_notification_start_time = bs.food_notification_start_time,
  food_notification_end_time = bs.food_notification_end_time,
  water_notification_start_time = bs.water_notification_start_time,
  water_notification_end_time = bs.water_notification_end_time
FROM backup_settings bs
WHERE ns.user_id = bs.user_id;
*/

