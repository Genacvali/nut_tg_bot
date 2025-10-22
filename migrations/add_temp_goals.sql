-- Добавляем поле для временного хранения предложенных целей
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS temp_goals JSONB DEFAULT NULL;

-- Комментарий для поля
COMMENT ON COLUMN users.temp_goals IS 'Временное хранение предложенных целей до подтверждения пользователем';

