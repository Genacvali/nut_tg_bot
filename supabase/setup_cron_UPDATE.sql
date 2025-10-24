-- ========================================
-- ОБНОВЛЕНИЕ pg_cron (для повторной настройки)
-- Используйте этот скрипт если задача уже существует
-- ========================================

-- Шаг 1: Удаляем существующую задачу (безопасно)
DO $$
BEGIN
  PERFORM cron.unschedule('send-notifications');
  RAISE NOTICE 'Задача send-notifications удалена';
EXCEPTION 
  WHEN OTHERS THEN
    RAISE NOTICE 'Задача send-notifications не найдена (это нормально)';
END $$;

-- Шаг 2: Создаем новую задачу
-- ⚠️ ЗАМЕНИТЕ ДВА ЗНАЧЕНИЯ:
-- 1. YOUR_PROJECT_REF - ваш Project Reference
-- 2. YOUR_SERVICE_ROLE_KEY - ваш service_role ключ

SELECT cron.schedule(
  'send-notifications',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notification-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Шаг 3: Проверка
SELECT 
  jobid,
  jobname,
  schedule,
  active
FROM cron.job
WHERE jobname = 'send-notifications';

