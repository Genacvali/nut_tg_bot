-- ============================================
-- ДОБАВЛЕНИЕ ПОДДЕРЖКИ ДОНАТОВ
-- ============================================
-- Делаем plan_id nullable для поддержки донатов
-- ============================================

-- Убираем NOT NULL constraint с plan_id
ALTER TABLE payment_intents 
ALTER COLUMN plan_id DROP NOT NULL;

-- Добавляем флаг для донатов
ALTER TABLE payment_intents 
ADD COLUMN IF NOT EXISTS is_donation BOOLEAN DEFAULT FALSE;

-- Добавляем индекс для донатов
CREATE INDEX IF NOT EXISTS idx_payment_intents_donation 
  ON payment_intents(is_donation) WHERE is_donation = TRUE;

-- Комментарий
COMMENT ON COLUMN payment_intents.plan_id IS 'ID плана подписки (NULL для донатов)';
COMMENT ON COLUMN payment_intents.is_donation IS 'Флаг доната (TRUE для поддержки проекта)';

-- Проверяем результат
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'payment_intents' 
  AND column_name IN ('plan_id', 'is_donation')
ORDER BY ordinal_position;

