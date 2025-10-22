-- Настройка автоматических ежедневных отчетов через pg_cron

-- 1. Включите расширение pg_cron (если еще не включено)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Создайте задачу для отправки ежедневных отчетов в 21:00
SELECT cron.schedule(
  'daily-nutrition-reports',     -- название задачи
  '0 21 * * *',                   -- каждый день в 21:00 (cron expression)
  $$
  SELECT net.http_post(
    url := 'https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/daily-reports',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 3. Проверьте созданные задачи
SELECT * FROM cron.job;

-- 4. Если нужно удалить задачу (для отладки)
-- SELECT cron.unschedule('daily-nutrition-reports');

-- 5. Проверьте логи выполнения
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
