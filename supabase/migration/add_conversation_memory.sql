-- ============================================
-- CONVERSATION MEMORY: История разговоров с AI
-- ============================================
-- Дата: 2025-10-27
-- Описание: Система для сохранения контекста разговоров пользователей
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА ИСТОРИИ РАЗГОВОРОВ
-- ============================================

CREATE TABLE IF NOT EXISTS conversation_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Роль отправителя
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),

  -- Содержание сообщения
  content TEXT NOT NULL,

  -- Определенное намерение (для user сообщений)
  intent VARCHAR(50),

  -- Уверенность в намерении (0.0 - 1.0)
  confidence DECIMAL(3,2),

  -- Метаданные (JSON для доп. инфо)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Временные метки
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Мягкое удаление
  deleted_at TIMESTAMPTZ
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_conversation_user_time
  ON conversation_history(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_user_role
  ON conversation_history(user_id, role, created_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================
-- 2. ФУНКЦИЯ: Получить последние N сообщений
-- ============================================

CREATE OR REPLACE FUNCTION get_recent_messages(
  p_user_id BIGINT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  id BIGINT,
  role VARCHAR(20),
  content TEXT,
  intent VARCHAR(50),
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ch.id,
    ch.role,
    ch.content,
    ch.intent,
    ch.confidence,
    ch.created_at
  FROM conversation_history ch
  WHERE ch.user_id = p_user_id
    AND ch.deleted_at IS NULL
  ORDER BY ch.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. ФУНКЦИЯ: Добавить сообщение в историю
-- ============================================

CREATE OR REPLACE FUNCTION add_conversation_message(
  p_user_id BIGINT,
  p_role VARCHAR(20),
  p_content TEXT,
  p_intent VARCHAR(50) DEFAULT NULL,
  p_confidence DECIMAL(3,2) DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT AS $$
DECLARE
  v_message_id BIGINT;
BEGIN
  -- Вставляем новое сообщение
  INSERT INTO conversation_history (
    user_id, role, content, intent, confidence, metadata
  )
  VALUES (
    p_user_id, p_role, p_content, p_intent, p_confidence, p_metadata
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. ФУНКЦИЯ: Очистить историю пользователя
-- ============================================

CREATE OR REPLACE FUNCTION clear_conversation_history(
  p_user_id BIGINT,
  p_hard_delete BOOLEAN DEFAULT FALSE
)
RETURNS INT AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  IF p_hard_delete THEN
    -- Полное удаление
    DELETE FROM conversation_history
    WHERE user_id = p_user_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  ELSE
    -- Мягкое удаление (soft delete)
    UPDATE conversation_history
    SET deleted_at = NOW()
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  END IF;

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. ФУНКЦИЯ: Получить текущую тему разговора
-- ============================================

CREATE OR REPLACE FUNCTION get_conversation_topic(
  p_user_id BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_recent_intents TEXT[];
  v_dominant_intent TEXT;
  v_messages_count INT;
  v_last_message_time TIMESTAMPTZ;
BEGIN
  -- Получаем последние 5 намерений
  SELECT
    ARRAY_AGG(intent ORDER BY created_at DESC),
    COUNT(*),
    MAX(created_at)
  INTO v_recent_intents, v_messages_count, v_last_message_time
  FROM conversation_history
  WHERE user_id = p_user_id
    AND role = 'user'
    AND intent IS NOT NULL
    AND deleted_at IS NULL
    AND created_at > NOW() - INTERVAL '30 minutes'
  LIMIT 5;

  -- Если нет сообщений
  IF v_messages_count = 0 THEN
    RETURN jsonb_build_object(
      'topic', NULL,
      'confidence', 0,
      'messages_count', 0,
      'is_active', FALSE
    );
  END IF;

  -- Определяем доминирующее намерение
  SELECT intent
  INTO v_dominant_intent
  FROM (
    SELECT intent, COUNT(*) as cnt
    FROM UNNEST(v_recent_intents) AS intent
    GROUP BY intent
    ORDER BY cnt DESC
    LIMIT 1
  ) t;

  -- Проверяем активность (последнее сообщение < 5 мин назад)
  RETURN jsonb_build_object(
    'topic', v_dominant_intent,
    'confidence', CASE
      WHEN v_messages_count >= 3 THEN 0.9
      WHEN v_messages_count = 2 THEN 0.7
      ELSE 0.5
    END,
    'messages_count', v_messages_count,
    'is_active', v_last_message_time > NOW() - INTERVAL '5 minutes',
    'last_message_at', v_last_message_time
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. ФУНКЦИЯ: Автоочистка старых сообщений
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS INT AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  -- Удаляем сообщения старше 30 дней
  UPDATE conversation_history
  SET deleted_at = NOW()
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE conversation_history IS 'История разговоров пользователей с AI-ассистентом';
COMMENT ON COLUMN conversation_history.role IS 'Роль отправителя: user или assistant';
COMMENT ON COLUMN conversation_history.intent IS 'Определенное намерение: food, water, question, navigation';
COMMENT ON COLUMN conversation_history.confidence IS 'Уверенность AI в определении намерения (0.0 - 1.0)';

COMMENT ON FUNCTION get_recent_messages IS 'Получить последние N сообщений пользователя';
COMMENT ON FUNCTION add_conversation_message IS 'Добавить новое сообщение в историю';
COMMENT ON FUNCTION clear_conversation_history IS 'Очистить историю разговоров пользователя';
COMMENT ON FUNCTION get_conversation_topic IS 'Определить текущую тему разговора на основе истории';
COMMENT ON FUNCTION cleanup_old_conversations IS 'Автоматическая очистка сообщений старше 30 дней';

-- ============================================
-- 8. ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
-- ============================================
--
-- 1. Добавить сообщение пользователя:
-- SELECT add_conversation_message(42, 'user', 'Что лучше есть перед тренировкой?', 'question', 0.95);
--
-- 2. Добавить ответ ассистента:
-- SELECT add_conversation_message(42, 'assistant', 'Перед тренировкой за 1-2 часа хороши углеводы...');
--
-- 3. Получить последние 5 сообщений:
-- SELECT * FROM get_recent_messages(42, 5);
--
-- 4. Определить текущую тему:
-- SELECT get_conversation_topic(42);
--
-- 5. Очистить историю:
-- SELECT clear_conversation_history(42);
--
-- 6. Автоочистка старых сообщений (через cron):
-- SELECT cleanup_old_conversations();
-- ============================================
