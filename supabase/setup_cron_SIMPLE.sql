-- ========================================
-- ПРОСТАЯ НАСТРОЙКА pg_cron
-- Используйте этот скрипт для первой установки
-- ========================================

-- Шаг 1: Включаем расширение pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Шаг 2: Создаем задачу для отправки уведомлений
-- ⚠️ ЗАМЕНИТЕ ДВА ЗНАЧЕНИЯ:
-- 1. YOUR_PROJECT_REF - ваш Project Reference (Settings → API → Project URL)
-- 2. YOUR_SERVICE_ROLE_KEY - ваш service_role ключ (Settings → API → service_role secret)

SELECT cron.schedule(
  'send-notifications',           -- Название задачи
  '*/5 * * * *',                  -- Каждые 5 минут (можно изменить)
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

-- Шаг 3: Проверяем что задача создана
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename
FROM cron.job
WHERE jobname = 'send-notifications';

-- Ожидаемый результат:
-- Вы должны увидеть одну строку с jobname = 'send-notifications' и active = true

-- ========================================
-- ДОПОЛНИТЕЛЬНЫЕ КОМАНДЫ
-- ========================================

-- Посмотреть все запланированные задачи:
-- SELECT * FROM cron.job;

-- Посмотреть логи выполнения (через 5-10 минут):
-- SELECT * FROM cron.job_run_details 
-- WHERE jobname = 'send-notifications'
-- ORDER BY start_time DESC 
-- LIMIT 5;

-- Удалить задачу (если нужно):
-- SELECT cron.unschedule('send-notifications');

-- Изменить расписание (удалите старую, создайте новую):
-- SELECT cron.unschedule('send-notifications');
-- SELECT cron.schedule('send-notifications', '*/10 * * * *', $$ ... $$);

