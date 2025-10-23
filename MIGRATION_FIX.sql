-- Исправление миграции для C.I.D. Bot v2.0
-- Выполните этот SQL в Supabase Dashboard → SQL Editor

-- 1. Добавить недостающие колонки в user_profiles
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS name VARCHAR(255),
ADD COLUMN IF NOT EXISTS wishes TEXT;

-- 2. Сделать target_weight опциональным (NULL разрешен)
ALTER TABLE user_profiles 
ALTER COLUMN target_weight DROP NOT NULL;

-- 3. Добавить недостающие колонки в nutrition_plans
ALTER TABLE nutrition_plans 
ADD COLUMN IF NOT EXISTS water DECIMAL(6,2),
ADD COLUMN IF NOT EXISTS activity_recommendations TEXT;

-- 4. Изменить constraint для activity_level
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_activity_level_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_activity_level_check 
  CHECK (activity_level IN ('low', 'medium', 'high'));

-- 5. Создать таблицу user_states для FSM
CREATE TABLE IF NOT EXISTS user_states (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    state_name VARCHAR(50),
    state_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Проверка: посмотреть структуру таблиц
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_profiles' 
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'nutrition_plans' 
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_states' 
ORDER BY ordinal_position;

