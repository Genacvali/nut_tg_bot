-- Добавляем поля для отслеживания расходов на OpenAI API
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS openai_cost_total DECIMAL(10, 4) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS openai_requests_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMP WITH TIME ZONE;

-- Создаем индекс для быстрого поиска спамеров
CREATE INDEX IF NOT EXISTS idx_users_openai_cost ON users(openai_cost_total DESC);

-- Комментарии для полей
COMMENT ON COLUMN users.openai_cost_total IS 'Общая стоимость запросов к OpenAI API в USD';
COMMENT ON COLUMN users.openai_requests_count IS 'Количество запросов к OpenAI API';
COMMENT ON COLUMN users.last_request_at IS 'Время последнего запроса к OpenAI API';

