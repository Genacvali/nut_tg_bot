-- Добавляем поле для хранения контекста разговора
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS conversation_context JSONB DEFAULT '[]'::jsonb;

-- Комментарий для поля
COMMENT ON COLUMN users.conversation_context IS 'Контекст последних сообщений для поддержания диалога';

