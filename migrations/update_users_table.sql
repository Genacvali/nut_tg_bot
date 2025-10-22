-- Обновление таблицы users для хранения параметров пользователя

-- Добавляем новые колонки
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS height INTEGER,
ADD COLUMN IF NOT EXISTS weight INTEGER,
ADD COLUMN IF NOT EXISTS goal TEXT CHECK (goal IN ('lose', 'gain')),
ADD COLUMN IF NOT EXISTS target_weight INTEGER,
ADD COLUMN IF NOT EXISTS activity TEXT CHECK (activity IN ('low', 'medium', 'high'));

-- Обновляем существующих пользователей (если есть)
UPDATE users 
SET 
  height = 180,
  weight = 80,
  goal = 'lose',
  target_weight = 70,
  activity = 'medium'
WHERE height IS NULL;
