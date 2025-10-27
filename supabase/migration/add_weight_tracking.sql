-- ============================================
-- WEIGHT TRACKING: Отслеживание веса
-- ============================================
-- Дата: 2025-10-27
-- Описание: Добавляем возможность отслеживать вес для визуализации прогресса
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА ЛОГОВ ВЕСА
-- ============================================

CREATE TABLE IF NOT EXISTS weight_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Вес в килограммах
  weight DECIMAL(5,2) NOT NULL CHECK (weight > 0 AND weight < 500),

  -- Время измерения
  logged_at TIMESTAMPTZ DEFAULT NOW(),

  -- Заметка (опционально)
  note TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_id ON weight_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, logged_at DESC);

-- ============================================
-- 2. ФУНКЦИЯ: Логировать вес
-- ============================================

CREATE OR REPLACE FUNCTION log_weight(
  p_user_id BIGINT,
  p_weight DECIMAL(5,2),
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_log_id BIGINT;
  v_previous_weight DECIMAL(5,2);
  v_weight_change DECIMAL(5,2);
BEGIN
  -- Получаем предыдущее значение веса
  SELECT weight INTO v_previous_weight
  FROM weight_logs
  WHERE user_id = p_user_id
  ORDER BY logged_at DESC
  LIMIT 1;

  -- Создаем новый лог
  INSERT INTO weight_logs (user_id, weight, note, logged_at)
  VALUES (p_user_id, p_weight, p_note, NOW())
  RETURNING id INTO v_log_id;

  -- Вычисляем изменение
  v_weight_change := CASE
    WHEN v_previous_weight IS NOT NULL THEN p_weight - v_previous_weight
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'weight', p_weight,
    'previous_weight', v_previous_weight,
    'weight_change', v_weight_change
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. ФУНКЦИЯ: Получить статистику веса
-- ============================================

CREATE OR REPLACE FUNCTION get_weight_stats(
  p_user_id BIGINT,
  p_days INT DEFAULT 30
)
RETURNS JSONB AS $$
DECLARE
  v_current_weight DECIMAL(5,2);
  v_start_weight DECIMAL(5,2);
  v_min_weight DECIMAL(5,2);
  v_max_weight DECIMAL(5,2);
  v_weight_change DECIMAL(5,2);
  v_logs_count INT;
BEGIN
  -- Текущий вес (последнее измерение)
  SELECT weight INTO v_current_weight
  FROM weight_logs
  WHERE user_id = p_user_id
  ORDER BY logged_at DESC
  LIMIT 1;

  -- Вес в начале периода
  SELECT weight INTO v_start_weight
  FROM weight_logs
  WHERE user_id = p_user_id
    AND logged_at >= NOW() - INTERVAL '1 day' * p_days
  ORDER BY logged_at ASC
  LIMIT 1;

  -- Минимальный и максимальный вес за период
  SELECT
    MIN(weight),
    MAX(weight),
    COUNT(*)
  INTO v_min_weight, v_max_weight, v_logs_count
  FROM weight_logs
  WHERE user_id = p_user_id
    AND logged_at >= NOW() - INTERVAL '1 day' * p_days;

  -- Изменение веса
  v_weight_change := CASE
    WHEN v_start_weight IS NOT NULL AND v_current_weight IS NOT NULL
    THEN v_current_weight - v_start_weight
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'current_weight', v_current_weight,
    'start_weight', v_start_weight,
    'min_weight', v_min_weight,
    'max_weight', v_max_weight,
    'weight_change', v_weight_change,
    'logs_count', v_logs_count,
    'days', p_days
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. ФУНКЦИЯ: Получить историю веса
-- ============================================

CREATE OR REPLACE FUNCTION get_weight_history(
  p_user_id BIGINT,
  p_limit INT DEFAULT 30
)
RETURNS TABLE(
  id BIGINT,
  weight DECIMAL(5,2),
  logged_at TIMESTAMPTZ,
  note TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.weight,
    w.logged_at,
    w.note
  FROM weight_logs w
  WHERE w.user_id = p_user_id
  ORDER BY w.logged_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE weight_logs IS 'Логи измерений веса пользователей';
COMMENT ON FUNCTION log_weight IS 'Логирует новое измерение веса и возвращает изменение относительно предыдущего';
COMMENT ON FUNCTION get_weight_stats IS 'Возвращает статистику веса за указанный период';
COMMENT ON FUNCTION get_weight_history IS 'Возвращает историю измерений веса';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Залогировать вес:
-- SELECT log_weight(42, 85.5, 'Утро, натощак');
--
-- 2. Получить статистику:
-- SELECT get_weight_stats(42, 30);
--
-- 3. Получить историю:
-- SELECT * FROM get_weight_history(42, 10);
-- ============================================
