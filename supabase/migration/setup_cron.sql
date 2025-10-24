-- Настройка pg_cron для автоматической отправки уведомлений
-- Выполните этот скрипт в Supabase SQL Editor

-- Включаем расширение pg_cron (если еще не включено)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Удаляем старую задачу, если существует (безопасно)
DO $$
BEGIN
  PERFORM cron.unschedule('send-notifications');
EXCEPTION 
  WHEN OTHERS THEN
    NULL; -- Игнорируем ошибку если задача не существует
END $$;

-- Создаем задачу для отправки уведомлений каждые 5 минут
-- Функция будет вызываться каждые 5 минут и проверять, 
-- нужно ли отправить уведомления пользователям
SELECT cron.schedule(
  'send-notifications',
  '*/5 * * * *', -- Каждые 5 минут
  $$
  SELECT
    net.http_post(
      url := 'https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/notification-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Проверить список запланированных задач
SELECT * FROM cron.job;

-- Примечание:
-- 1. Замените YOUR_PROJECT_REF на ваш Project Reference из Supabase Dashboard
-- 2. Убедитесь, что app.service_role_key настроен в вашем проекте
-- 3. Если нужно изменить частоту, измените cron выражение:
--    - '*/5 * * * *' - каждые 5 минут
--    - '*/10 * * * *' - каждые 10 минут
--    - '*/15 * * * *' - каждые 15 минут

-- Для отладки: просмотр логов выполнения
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

