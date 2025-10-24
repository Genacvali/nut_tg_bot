-- ========================================
-- ИСПРАВЛЕНИЕ ПОЛЯ ВЕСА В ПРОФИЛЯХ
-- Переименование current_weight в weight
-- ========================================

-- Проверяем есть ли колонка current_weight
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'user_profiles'
    AND column_name = 'current_weight'
  ) THEN
    -- Если есть колонка current_weight, копируем её значение в weight
    UPDATE user_profiles
    SET weight = current_weight
    WHERE current_weight IS NOT NULL
    AND weight IS NULL;
    
    RAISE NOTICE 'Скопированы значения из current_weight в weight';
    
    -- Можно удалить колонку current_weight (опционально)
    -- ALTER TABLE user_profiles DROP COLUMN IF EXISTS current_weight;
    -- RAISE NOTICE 'Колонка current_weight удалена';
  ELSE
    RAISE NOTICE 'Колонка current_weight не найдена, миграция не требуется';
  END IF;
END $$;

-- Проверка результата
SELECT 
  user_id,
  weight,
  height,
  age
FROM user_profiles
WHERE weight IS NOT NULL
ORDER BY user_id DESC
LIMIT 10;

