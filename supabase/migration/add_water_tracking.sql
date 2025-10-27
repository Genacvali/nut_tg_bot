-- ============================================
-- WATER TRACKING: Отслеживание потребления воды
-- ============================================
-- Дата: 2025-10-27
-- Описание: Система для логирования потребления воды
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА ЛОГОВ ВОДЫ
-- ============================================

CREATE TABLE IF NOT EXISTS water_intake_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Количество воды в миллилитрах
  amount_ml INT NOT NULL CHECK (amount_ml > 0 AND amount_ml <= 5000),

  -- Время логирования
  logged_at TIMESTAMPTZ DEFAULT NOW(),

  -- Заметка (опционально)
  note TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_water_intake_user_id ON water_intake_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_water_intake_user_date ON water_intake_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_water_intake_logged_at ON water_intake_logs(logged_at DESC);

-- ============================================
-- 2. ФУНКЦИЯ: Логировать воду
-- ============================================

CREATE OR REPLACE FUNCTION log_water_intake(
  p_user_id BIGINT,
  p_amount_ml INT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_log_id BIGINT;
  v_today_total INT;
  v_target_ml INT;
  v_progress_percent INT;
BEGIN
  -- Получаем целевое количество воды из плана
  SELECT COALESCE(ROUND(water * 1000), 2000) INTO v_target_ml
  FROM nutrition_plans
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;

  -- Создаем новый лог
  INSERT INTO water_intake_logs (user_id, amount_ml, note, logged_at)
  VALUES (p_user_id, p_amount_ml, p_note, NOW())
  RETURNING id INTO v_log_id;

  -- Считаем общее потребление за сегодня
  SELECT COALESCE(SUM(amount_ml), 0) INTO v_today_total
  FROM water_intake_logs
  WHERE user_id = p_user_id
    AND logged_at::date = CURRENT_DATE;

  -- Вычисляем процент выполнения
  v_progress_percent := ROUND((v_today_total::DECIMAL / v_target_ml) * 100);

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'amount_ml', p_amount_ml,
    'today_total_ml', v_today_total,
    'target_ml', v_target_ml,
    'progress_percent', v_progress_percent,
    'remaining_ml', GREATEST(0, v_target_ml - v_today_total)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. ФУНКЦИЯ: Получить статистику воды за день
-- ============================================

CREATE OR REPLACE FUNCTION get_water_stats_today(
  p_user_id BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_today_total INT;
  v_target_ml INT;
  v_logs_count INT;
  v_progress_percent INT;
BEGIN
  -- Получаем целевое количество
  SELECT COALESCE(ROUND(water * 1000), 2000) INTO v_target_ml
  FROM nutrition_plans
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;

  -- Считаем сегодняшнее потребление
  SELECT
    COALESCE(SUM(amount_ml), 0),
    COUNT(*)
  INTO v_today_total, v_logs_count
  FROM water_intake_logs
  WHERE user_id = p_user_id
    AND logged_at::date = CURRENT_DATE;

  -- Процент
  v_progress_percent := ROUND((v_today_total::DECIMAL / v_target_ml) * 100);

  RETURN jsonb_build_object(
    'today_total_ml', v_today_total,
    'target_ml', v_target_ml,
    'logs_count', v_logs_count,
    'progress_percent', v_progress_percent,
    'remaining_ml', GREATEST(0, v_target_ml - v_today_total),
    'is_goal_reached', v_today_total >= v_target_ml
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. ФУНКЦИЯ: Получить историю воды за период
-- ============================================

CREATE OR REPLACE FUNCTION get_water_history(
  p_user_id BIGINT,
  p_days INT DEFAULT 7
)
RETURNS TABLE(
  date DATE,
  total_ml INT,
  logs_count INT,
  target_ml INT,
  progress_percent INT
) AS $$
DECLARE
  v_target_ml INT;
BEGIN
  -- Получаем целевое количество
  SELECT COALESCE(ROUND(water * 1000), 2000) INTO v_target_ml
  FROM nutrition_plans
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;

  RETURN QUERY
  SELECT
    w.logged_at::date as date,
    COALESCE(SUM(w.amount_ml), 0)::INT as total_ml,
    COUNT(*)::INT as logs_count,
    v_target_ml as target_ml,
    ROUND((COALESCE(SUM(w.amount_ml), 0)::DECIMAL / v_target_ml) * 100)::INT as progress_percent
  FROM generate_series(
    CURRENT_DATE - (p_days - 1),
    CURRENT_DATE,
    '1 day'::interval
  ) AS dates(day)
  LEFT JOIN water_intake_logs w
    ON w.user_id = p_user_id
    AND w.logged_at::date = dates.day::date
  GROUP BY dates.day
  ORDER BY dates.day DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. ФУНКЦИЯ: Удалить лог воды
-- ============================================

CREATE OR REPLACE FUNCTION delete_water_log(
  p_user_id BIGINT,
  p_log_id BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  DELETE FROM water_intake_logs
  WHERE id = p_log_id AND user_id = p_user_id
  RETURNING TRUE INTO v_deleted;

  RETURN COALESCE(v_deleted, FALSE);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE water_intake_logs IS 'Логи потребления воды пользователями';
COMMENT ON FUNCTION log_water_intake IS 'Логирует потребление воды и возвращает статистику за день';
COMMENT ON FUNCTION get_water_stats_today IS 'Возвращает статистику воды за сегодня';
COMMENT ON FUNCTION get_water_history IS 'Возвращает историю потребления воды за указанный период';
COMMENT ON FUNCTION delete_water_log IS 'Удаляет лог воды';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Залогировать воду:
-- SELECT log_water_intake(42, 500, 'Утро');
--
-- 2. Статистика за сегодня:
-- SELECT get_water_stats_today(42);
--
-- 3. История за неделю:
-- SELECT * FROM get_water_history(42, 7);
--
-- 4. Удалить лог:
-- SELECT delete_water_log(42, 1);
-- ============================================
