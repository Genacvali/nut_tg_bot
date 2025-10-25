-- ========================================
-- ДОБАВЛЕНИЕ ИСТОРИИ ЧАТА И ПРЕДПОЧТЕНИЙ ПОЛЬЗОВАТЕЛЯ
-- Для сохранения контекста диалога
-- ========================================

-- Таблица истории диалогов с AI
CREATE TABLE IF NOT EXISTS chat_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска последних сообщений
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_created ON chat_history(user_id, created_at DESC);

-- Таблица предпочтений пользователя
CREATE TABLE IF NOT EXISTS user_preferences (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_type VARCHAR(50) NOT NULL, -- 'allergy', 'intolerance', 'dislike', 'exclude', 'preference'
    item VARCHAR(255) NOT NULL, -- название продукта/категории
    description TEXT, -- дополнительное описание
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, preference_type, item)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_type ON user_preferences(user_id, preference_type);

-- Функция для автоматической очистки старых сообщений (оставляем только последние 50 на пользователя)
CREATE OR REPLACE FUNCTION cleanup_old_chat_history()
RETURNS void AS $$
BEGIN
    DELETE FROM chat_history
    WHERE id IN (
        SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
            FROM chat_history
        ) t
        WHERE t.rn > 50
    );
END;
$$ LANGUAGE plpgsql;

-- Комментарии для документации
COMMENT ON TABLE chat_history IS 'История диалогов пользователей с AI-ассистентом';
COMMENT ON TABLE user_preferences IS 'Предпочтения пользователей по питанию (аллергии, непереносимости, исключения)';
COMMENT ON COLUMN user_preferences.preference_type IS 'Тип предпочтения: allergy (аллергия), intolerance (непереносимость), dislike (не нравится), exclude (исключить), preference (предпочтение)';

