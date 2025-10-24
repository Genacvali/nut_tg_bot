-- ========================================
-- АВТОМАТИЧЕСКАЯ ОЧИСТКА СТАРЫХ ЗАПИСЕЙ
-- Удаляет приемы пищи старше 2 суток
-- ========================================

-- Способ 1: Создать функцию для очистки
CREATE OR REPLACE FUNCTION cleanup_old_food_logs()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Удаляем записи старше 2 суток
  DELETE FROM food_logs
  WHERE logged_at < NOW() - INTERVAL '2 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Удалено старых записей: %', deleted_count;
  
  RETURN deleted_count;
END;
$$;

-- ========================================
-- Способ 2: Настроить автоматический запуск через pg_cron
-- ========================================

-- Убедитесь что pg_cron включен
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Удаляем старую задачу если существует
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-food-logs');
EXCEPTION 
  WHEN OTHERS THEN
    NULL;
END $$;

-- Запускать очистку каждый день в 3:00 ночи
SELECT cron.schedule(
  'cleanup-old-food-logs',
  '0 3 * * *',  -- Каждый день в 3:00
  'SELECT cleanup_old_food_logs();'
);

-- ========================================
-- Способ 3: Политика Row Level Security (RLS) для автоматической фильтрации
-- (Не удаляет данные, но скрывает старые записи)
-- ========================================

-- Создать View который показывает только последние 2 дня
CREATE OR REPLACE VIEW food_logs_recent AS
SELECT * FROM food_logs
WHERE logged_at >= NOW() - INTERVAL '2 days';

-- Предоставить права на view
GRANT SELECT ON food_logs_recent TO authenticated;
GRANT SELECT ON food_logs_recent TO anon;

-- ========================================
-- ПРОВЕРКА И ТЕСТИРОВАНИЕ
-- ========================================

-- Посмотреть сколько записей будет удалено
SELECT 
  COUNT(*) as records_to_delete,
  MIN(logged_at) as oldest_record,
  MAX(logged_at) as newest_old_record
FROM food_logs
WHERE logged_at < NOW() - INTERVAL '2 days';

-- Посмотреть распределение записей по датам
SELECT 
  DATE(logged_at) as date,
  COUNT(*) as records_count
FROM food_logs
GROUP BY DATE(logged_at)
ORDER BY date DESC;

-- Запустить очистку вручную (для теста)
-- SELECT cleanup_old_food_logs();

-- Посмотреть запланированные задачи cron
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'cleanup-old-food-logs';

-- Посмотреть логи выполнения задачи
SELECT 
  jrd.jobid,
  jrd.runid,
  jrd.status,
  jrd.return_message,
  jrd.start_time,
  jrd.end_time
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE j.jobname = 'cleanup-old-food-logs'
ORDER BY jrd.start_time DESC 
LIMIT 10;

-- ========================================
-- ДОПОЛНИТЕЛЬНО: Архивирование перед удалением
-- ========================================

-- Создать таблицу архива (опционально)
CREATE TABLE IF NOT EXISTS food_logs_archive (
  LIKE food_logs INCLUDING ALL
);

-- Функция с архивированием
CREATE OR REPLACE FUNCTION cleanup_old_food_logs_with_archive()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Сначала копируем в архив
  INSERT INTO food_logs_archive
  SELECT * FROM food_logs
  WHERE logged_at < NOW() - INTERVAL '2 days'
  ON CONFLICT DO NOTHING;
  
  -- Затем удаляем из основной таблицы
  DELETE FROM food_logs
  WHERE logged_at < NOW() - INTERVAL '2 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Заархивировано и удалено записей: %', deleted_count;
  
  RETURN deleted_count;
END;
$$;

-- ========================================
-- ИЗМЕНЕНИЕ РАСПИСАНИЯ
-- ========================================

-- Если хотите изменить время или частоту:
-- 
-- Каждый день в полночь:
-- '0 0 * * *'
-- 
-- Каждый день в 3:00:
-- '0 3 * * *'
-- 
-- Каждую неделю в воскресенье в 2:00:
-- '0 2 * * 0'
-- 
-- Каждый час:
-- '0 * * * *'

-- Обновить расписание:
-- SELECT cron.unschedule('cleanup-old-food-logs');
-- SELECT cron.schedule('cleanup-old-food-logs', 'НОВОЕ_РАСПИСАНИЕ', 'SELECT cleanup_old_food_logs();');

