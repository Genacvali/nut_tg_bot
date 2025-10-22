-- Добавляем поле для хранения ID редактируемого блюда

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS editing_meal_id BIGINT;

COMMENT ON COLUMN users.editing_meal_id IS 'ID блюда, которое пользователь редактирует';
