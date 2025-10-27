-- ============================================
-- МИГРАЦИЯ: Rate Limiting + AI Cache
-- ============================================
-- Дата: 2025-10-27
-- Описание: Добавляем rate limiting и кеширование OpenAI запросов
-- ============================================

-- ============================================
-- 1. RATE LIMITING
-- ============================================

-- Таблица для отслеживания лимитов запросов
CREATE TABLE IF NOT EXISTS rate_limits (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    requests_count INT DEFAULT 0,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрой очистки старых записей
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- Функция проверки rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_user_id BIGINT,
    p_max_requests INT DEFAULT 30,
    p_window_minutes INT DEFAULT 1
) RETURNS JSONB AS $$
DECLARE
    v_count INT;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
BEGIN
    -- Получаем текущее окно
    SELECT requests_count, window_start
    INTO v_count, v_window_start
    FROM rate_limits
    WHERE user_id = p_user_id;

    -- Вычисляем конец окна
    v_window_end := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    -- Если окно истекло или записи нет - сбрасываем
    IF v_window_start IS NULL OR v_window_start < v_window_end THEN
        INSERT INTO rate_limits (user_id, requests_count, window_start)
        VALUES (p_user_id, 1, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET requests_count = 1,
            window_start = NOW(),
            updated_at = NOW();

        RETURN jsonb_build_object(
            'allowed', true,
            'remaining', p_max_requests - 1,
            'reset_at', NOW() + (p_window_minutes || ' minutes')::INTERVAL
        );
    END IF;

    -- Проверяем лимит
    IF v_count >= p_max_requests THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'remaining', 0,
            'retry_after', EXTRACT(EPOCH FROM (v_window_start + (p_window_minutes || ' minutes')::INTERVAL - NOW()))::INT,
            'reset_at', v_window_start + (p_window_minutes || ' minutes')::INTERVAL
        );
    END IF;

    -- Инкрементим счетчик
    UPDATE rate_limits
    SET requests_count = requests_count + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining', p_max_requests - v_count - 1,
        'reset_at', v_window_start + (p_window_minutes || ' minutes')::INTERVAL
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. AI CACHE
-- ============================================

-- Таблица для кеширования AI ответов
CREATE TABLE IF NOT EXISTS ai_cache (
    id BIGSERIAL PRIMARY KEY,
    cache_key TEXT UNIQUE NOT NULL,
    cache_type VARCHAR(50) NOT NULL, -- 'food_analysis', 'recipe', 'nutrition_plan', 'chat'
    request_data JSONB NOT NULL,
    response_data JSONB NOT NULL,
    hit_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_type ON ai_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at);

-- Функция для получения из кеша
CREATE OR REPLACE FUNCTION get_from_cache(
    p_cache_key TEXT
) RETURNS JSONB AS $$
DECLARE
    v_response JSONB;
BEGIN
    -- Получаем из кеша и инкрементим счетчик
    UPDATE ai_cache
    SET hit_count = hit_count + 1,
        updated_at = NOW()
    WHERE cache_key = p_cache_key
      AND expires_at > NOW()
    RETURNING response_data INTO v_response;

    RETURN v_response;
END;
$$ LANGUAGE plpgsql;

-- Функция для сохранения в кеш
CREATE OR REPLACE FUNCTION save_to_cache(
    p_cache_key TEXT,
    p_cache_type VARCHAR(50),
    p_request_data JSONB,
    p_response_data JSONB,
    p_ttl_seconds INT DEFAULT 2592000 -- 30 дней по умолчанию
) RETURNS VOID AS $$
BEGIN
    INSERT INTO ai_cache (cache_key, cache_type, request_data, response_data, expires_at)
    VALUES (
        p_cache_key,
        p_cache_type,
        p_request_data,
        p_response_data,
        NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
    )
    ON CONFLICT (cache_key) DO UPDATE
    SET response_data = p_response_data,
        updated_at = NOW(),
        expires_at = NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. CLEANUP FUNCTIONS
-- ============================================

-- Функция очистки устаревших данных
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS TABLE(
    deleted_cache_entries BIGINT,
    deleted_rate_limits BIGINT
) AS $$
DECLARE
    v_deleted_cache BIGINT;
    v_deleted_rate_limits BIGINT;
BEGIN
    -- Удаляем истекший кеш
    DELETE FROM ai_cache
    WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted_cache = ROW_COUNT;

    -- Удаляем старые rate limits (старше 1 часа)
    DELETE FROM rate_limits
    WHERE window_start < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted_rate_limits = ROW_COUNT;

    RETURN QUERY SELECT v_deleted_cache, v_deleted_rate_limits;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. АНАЛИТИКА КЕША
-- ============================================

-- View для статистики кеша
CREATE OR REPLACE VIEW ai_cache_stats AS
SELECT
    cache_type,
    COUNT(*) as total_entries,
    SUM(hit_count) as total_hits,
    AVG(hit_count) as avg_hits_per_entry,
    COUNT(*) FILTER (WHERE expires_at > NOW()) as active_entries,
    COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired_entries
FROM ai_cache
GROUP BY cache_type;

-- View для статистики rate limiting
CREATE OR REPLACE VIEW rate_limit_stats AS
SELECT
    COUNT(*) as total_users,
    AVG(requests_count) as avg_requests,
    MAX(requests_count) as max_requests,
    COUNT(*) FILTER (WHERE window_start > NOW() - INTERVAL '1 minute') as active_users_last_minute
FROM rate_limits;

-- ============================================
-- КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE rate_limits IS 'Отслеживание лимитов запросов пользователей для защиты от спама';
COMMENT ON TABLE ai_cache IS 'Кеширование ответов OpenAI для экономии средств и ускорения работы';
COMMENT ON FUNCTION check_rate_limit IS 'Проверяет и обновляет rate limit для пользователя';
COMMENT ON FUNCTION get_from_cache IS 'Получает данные из кеша и инкрементит счетчик попаданий';
COMMENT ON FUNCTION save_to_cache IS 'Сохраняет данные в кеш с TTL';
COMMENT ON FUNCTION cleanup_old_data IS 'Очищает устаревшие данные из rate_limits и ai_cache';
