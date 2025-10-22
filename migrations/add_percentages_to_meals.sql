-- Добавляем поля для процентного соотношения БЖУ в таблицу meals

ALTER TABLE meals 
ADD COLUMN IF NOT EXISTS protein_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS carbs_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS fat_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT 100;

-- Добавляем комментарии для понимания
COMMENT ON COLUMN meals.protein_percent IS 'Процент белка от общей калорийности';
COMMENT ON COLUMN meals.carbs_percent IS 'Процент углеводов от общей калорийности';
COMMENT ON COLUMN meals.fat_percent IS 'Процент жиров от общей калорийности';
COMMENT ON COLUMN meals.weight_grams IS 'Вес порции в граммах';
