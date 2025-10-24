-- ========================================
-- БЫСТРАЯ НАСТРОЙКА АВТООЧИСТКИ ПРИЕМОВ ПИЩИ
-- Удаляет записи старше 2 суток
-- Выполните этот SQL в Supabase SQL Editor
-- ========================================

-- 1. Создаем функцию очистки
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
  
  RAISE NOTICE '🗑 Удалено старых записей: %', deleted_count;
  
  RETURN deleted_count;
END;
$$;

-- 2. Включаем pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 3. Удаляем старую задачу если существует
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-food-logs');
EXCEPTION 
  WHEN OTHERS THEN
    NULL;
END $$;

-- 4. Настраиваем автоматический запуск каждый день в 3:00
SELECT cron.schedule(
  'cleanup-old-food-logs',
  '0 3 * * *',  -- Каждый день в 3:00 ночи
  'SELECT cleanup_old_food_logs();'
);

-- ========================================
-- ПРОВЕРКА
-- ========================================

-- Посмотреть созданную задачу
SELECT 
  jobid,
  jobname,
  schedule,
  active
FROM cron.job
WHERE jobname = 'cleanup-old-food-logs';

-- Посмотреть сколько записей будет удалено
SELECT 
  COUNT(*) as "Записей старше 2 дней",
  MIN(logged_at) as "Самая старая запись"
FROM food_logs
WHERE logged_at < NOW() - INTERVAL '2 days';

-- ========================================
-- РУЧНОЙ ЗАПУСК (для теста)
-- ========================================

-- Раскомментируйте строку ниже чтобы запустить очистку вручную:
-- SELECT cleanup_old_food_logs();

-- ========================================
-- ГОТОВО! ✅
-- ========================================
-- Теперь каждый день в 3:00 ночи старые записи будут автоматически удаляться

