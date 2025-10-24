-- ========================================
-- ДОБАВЛЕНИЕ ТРЕКИНГА БИЛЛИНГА LLM
-- Для выявления DDOS и злоупотреблений
-- ========================================

-- Добавляем поля биллинга в таблицу users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS total_tokens_used BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cost_usd DECIMAL(10, 4) DEFAULT 0.0000,
ADD COLUMN IF NOT EXISTS llm_requests_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_llm_request_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS requests_today INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_today DECIMAL(10, 4) DEFAULT 0.0000,
ADD COLUMN IF NOT EXISTS last_reset_date DATE DEFAULT CURRENT_DATE;

-- Создаем таблицу для детальной истории LLM запросов
CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL, -- 'nutrition_plan', 'food_analysis', 'recipe', etc.
  model TEXT NOT NULL, -- 'gpt-4', 'gpt-3.5-turbo', etc.
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd DECIMAL(10, 6) NOT NULL,
  request_duration_ms INTEGER, -- Время выполнения запроса в мс
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_llm_logs_user_id ON llm_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_logs_created_at ON llm_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_logs_user_date ON llm_usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_requests_today ON users(requests_today);
CREATE INDEX IF NOT EXISTS idx_users_cost_today ON users(cost_today);

-- Функция для записи LLM запроса и обновления счетчиков
CREATE OR REPLACE FUNCTION log_llm_usage(
  p_user_id BIGINT,
  p_request_type TEXT,
  p_model TEXT,
  p_prompt_tokens INTEGER,
  p_completion_tokens INTEGER,
  p_cost_usd DECIMAL,
  p_duration_ms INTEGER DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_tokens INTEGER;
  v_current_date DATE;
BEGIN
  v_total_tokens := p_prompt_tokens + p_completion_tokens;
  v_current_date := CURRENT_DATE;
  
  -- Записываем в историю
  INSERT INTO llm_usage_logs (
    user_id, request_type, model, 
    prompt_tokens, completion_tokens, total_tokens,
    cost_usd, request_duration_ms
  ) VALUES (
    p_user_id, p_request_type, p_model,
    p_prompt_tokens, p_completion_tokens, v_total_tokens,
    p_cost_usd, p_duration_ms
  );
  
  -- Обновляем счетчики пользователя
  UPDATE users
  SET 
    total_tokens_used = total_tokens_used + v_total_tokens,
    total_cost_usd = total_cost_usd + p_cost_usd,
    llm_requests_count = llm_requests_count + 1,
    last_llm_request_at = NOW(),
    -- Сбрасываем дневные счетчики если новый день
    requests_today = CASE 
      WHEN last_reset_date < v_current_date THEN 1 
      ELSE requests_today + 1 
    END,
    cost_today = CASE 
      WHEN last_reset_date < v_current_date THEN p_cost_usd 
      ELSE cost_today + p_cost_usd 
    END,
    last_reset_date = v_current_date
  WHERE id = p_user_id;
END;
$$;

-- Функция для получения статистики пользователя
CREATE OR REPLACE FUNCTION get_user_llm_stats(p_user_id BIGINT)
RETURNS TABLE (
  total_requests INTEGER,
  total_tokens BIGINT,
  total_cost DECIMAL,
  requests_today INTEGER,
  cost_today DECIMAL,
  avg_tokens_per_request DECIMAL,
  last_request TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.llm_requests_count,
    u.total_tokens_used,
    u.total_cost_usd,
    u.requests_today,
    u.cost_today,
    CASE 
      WHEN u.llm_requests_count > 0 
      THEN ROUND(u.total_tokens_used::DECIMAL / u.llm_requests_count, 2)
      ELSE 0 
    END,
    u.last_llm_request_at
  FROM users u
  WHERE u.id = p_user_id;
END;
$$;

-- View для топ-10 пользователей по расходам
CREATE OR REPLACE VIEW top_spenders AS
SELECT 
  u.id,
  u.telegram_id,
  u.username,
  u.llm_requests_count,
  u.total_tokens_used,
  u.total_cost_usd,
  u.requests_today,
  u.cost_today,
  u.last_llm_request_at,
  ROUND(u.total_tokens_used::DECIMAL / NULLIF(u.llm_requests_count, 0), 0) as avg_tokens_per_request
FROM users u
WHERE u.llm_requests_count > 0
ORDER BY u.total_cost_usd DESC
LIMIT 50;

-- View для подозрительной активности
CREATE OR REPLACE VIEW suspicious_activity AS
SELECT 
  u.id,
  u.telegram_id,
  u.username,
  u.requests_today,
  u.cost_today,
  u.llm_requests_count,
  u.total_cost_usd,
  u.last_llm_request_at,
  CASE
    WHEN u.requests_today > 100 THEN '🚨 Слишком много запросов за день'
    WHEN u.cost_today > 5.0 THEN '💰 Большие расходы за день'
    WHEN u.total_cost_usd > 20.0 THEN '💸 Большие общие расходы'
    ELSE '⚠️ Подозрительная активность'
  END as alert_reason
FROM users u
WHERE 
  u.requests_today > 100  -- Более 100 запросов в день
  OR u.cost_today > 5.0   -- Более $5 в день
  OR u.total_cost_usd > 20.0  -- Более $20 всего
ORDER BY u.requests_today DESC, u.cost_today DESC;

-- Функция автоматической очистки старых логов (>30 дней)
CREATE OR REPLACE FUNCTION cleanup_old_llm_logs()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM llm_usage_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Удалено старых LLM логов: %', deleted_count;
  
  RETURN deleted_count;
END;
$$;

-- Настраиваем автоматическую очистку через pg_cron (если нужно)
-- SELECT cron.schedule(
--   'cleanup-old-llm-logs',
--   '0 4 * * *',  -- Каждый день в 4:00
--   'SELECT cleanup_old_llm_logs();'
-- );

-- ========================================
-- ПРОВЕРКА
-- ========================================

-- Посмотреть топ пользователей
SELECT * FROM top_spenders LIMIT 10;

-- Посмотреть подозрительную активность
SELECT * FROM suspicious_activity;

-- Общая статистика
SELECT 
  COUNT(*) as total_users,
  SUM(llm_requests_count) as total_requests,
  SUM(total_tokens_used) as total_tokens,
  ROUND(SUM(total_cost_usd), 2) as total_cost_usd,
  ROUND(AVG(total_cost_usd), 4) as avg_cost_per_user,
  MAX(total_cost_usd) as max_user_cost
FROM users
WHERE llm_requests_count > 0;

COMMENT ON TABLE llm_usage_logs IS 'Детальная история всех LLM запросов для анализа и биллинга';
COMMENT ON FUNCTION log_llm_usage IS 'Записывает LLM запрос и обновляет счетчики пользователя';
COMMENT ON VIEW top_spenders IS 'Топ-50 пользователей по расходам на LLM';
COMMENT ON VIEW suspicious_activity IS 'Пользователи с подозрительной активностью (возможный DDOS/злоупотребление)';

