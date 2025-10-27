-- ============================================
-- STREAK СИСТЕМА (ГЕЙМИФИКАЦИЯ)
-- ============================================
-- Дата: 2025-10-27
-- Описание: Добавляем streak tracking для мотивации пользователей
-- Цель: Увеличить retention на 50%+ через Duolingo-эффект
-- ============================================

-- ============================================
-- 1. ДОБАВЛЯЕМ ПОЛЯ ДЛЯ STREAK
-- ============================================

-- Добавляем streak поля в таблицу users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS longest_streak INT DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_log_date DATE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS total_logs_count INT DEFAULT 0;

-- Добавляем индекс для быстрого поиска пользователей с streak
CREATE INDEX IF NOT EXISTS idx_users_current_streak ON users(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_log_date ON users(last_log_date);

-- ============================================
-- 2. ТАБЛИЦА ДЛЯ STREAK НАГРАД/БЕЙДЖЕЙ
-- ============================================

CREATE TABLE IF NOT EXISTS user_achievements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_type VARCHAR(50) NOT NULL, -- 'streak_3', 'streak_7', 'streak_14', 'streak_30', 'first_log', etc.
  achievement_name VARCHAR(255) NOT NULL,
  achievement_description TEXT,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_type)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_type ON user_achievements(achievement_type);

-- ============================================
-- 3. ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ STREAK
-- ============================================

CREATE OR REPLACE FUNCTION update_user_streak(
  p_user_id BIGINT
)
RETURNS TABLE(
  current_streak INT,
  longest_streak INT,
  is_new_record BOOLEAN,
  earned_achievements TEXT[]
) AS $$
DECLARE
  v_last_log_date DATE;
  v_current_streak INT;
  v_longest_streak INT;
  v_today DATE := CURRENT_DATE;
  v_is_new_record BOOLEAN := FALSE;
  v_achievements TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Получаем текущие значения
  SELECT last_log_date, current_streak, longest_streak
  INTO v_last_log_date, v_current_streak, v_longest_streak
  FROM users
  WHERE id = p_user_id;

  -- Если последний лог был сегодня - ничего не делаем
  IF v_last_log_date = v_today THEN
    RETURN QUERY SELECT v_current_streak, v_longest_streak, FALSE, ARRAY[]::TEXT[];
    RETURN;
  END IF;

  -- Если последний лог был вчера - продолжаем streak
  IF v_last_log_date = v_today - INTERVAL '1 day' THEN
    v_current_streak := v_current_streak + 1;
  -- Если больше чем 1 день назад - сбрасываем streak
  ELSIF v_last_log_date IS NULL OR v_last_log_date < v_today - INTERVAL '1 day' THEN
    v_current_streak := 1;
  END IF;

  -- Проверяем рекорд
  IF v_current_streak > v_longest_streak THEN
    v_longest_streak := v_current_streak;
    v_is_new_record := TRUE;
  END IF;

  -- Обновляем в БД
  UPDATE users
  SET
    current_streak = v_current_streak,
    longest_streak = v_longest_streak,
    last_log_date = v_today,
    total_logs_count = total_logs_count + 1
  WHERE id = p_user_id;

  -- Проверяем достижения
  -- 3 дня подряд
  IF v_current_streak = 3 THEN
    INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description)
    VALUES (p_user_id, 'streak_3', '🥉 Бронзовый streak', 'Логировал еду 3 дня подряд!')
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
    v_achievements := array_append(v_achievements, '🥉 Бронзовый бейдж');
  END IF;

  -- 7 дней подряд
  IF v_current_streak = 7 THEN
    INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description)
    VALUES (p_user_id, 'streak_7', '🥈 Серебряный streak', 'Логировал еду 7 дней подряд!')
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
    v_achievements := array_append(v_achievements, '🥈 Серебряный бейдж');
  END IF;

  -- 14 дней подряд
  IF v_current_streak = 14 THEN
    INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description)
    VALUES (p_user_id, 'streak_14', '🥇 Золотой streak', 'Логировал еду 14 дней подряд!')
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
    v_achievements := array_append(v_achievements, '🥇 Золотой бейдж');
  END IF;

  -- 30 дней подряд
  IF v_current_streak = 30 THEN
    INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description)
    VALUES (p_user_id, 'streak_30', '💎 Diamond streak', 'Логировал еду 30 дней подряд!')
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
    v_achievements := array_append(v_achievements, '💎 Diamond бейдж');
  END IF;

  -- 100 дней подряд
  IF v_current_streak = 100 THEN
    INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description)
    VALUES (p_user_id, 'streak_100', '🏆 Легенда', 'Логировал еду 100 дней подряд!')
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
    v_achievements := array_append(v_achievements, '🏆 Легендарный бейдж');
  END IF;

  RETURN QUERY SELECT v_current_streak, v_longest_streak, v_is_new_record, v_achievements;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ STREAK СТАТИСТИКИ
-- ============================================

CREATE OR REPLACE FUNCTION get_user_streak_stats(
  p_user_id BIGINT
)
RETURNS TABLE(
  current_streak INT,
  longest_streak INT,
  total_logs INT,
  last_log_date DATE,
  days_since_last_log INT,
  is_at_risk BOOLEAN,
  achievements JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.current_streak,
    u.longest_streak,
    u.total_logs_count,
    u.last_log_date,
    CASE
      WHEN u.last_log_date IS NOT NULL
      THEN EXTRACT(DAY FROM (CURRENT_DATE - u.last_log_date))::INT
      ELSE NULL
    END as days_since_last_log,
    -- Streak в опасности если не логировал сегодня и вчера
    CASE
      WHEN u.last_log_date IS NOT NULL AND u.last_log_date < CURRENT_DATE
      THEN TRUE
      ELSE FALSE
    END as is_at_risk,
    -- Собираем достижения в JSONB
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'type', achievement_type,
            'name', achievement_name,
            'description', achievement_description,
            'earned_at', earned_at
          )
          ORDER BY earned_at DESC
        )
        FROM user_achievements
        WHERE user_id = p_user_id
      ),
      '[]'::jsonb
    ) as achievements
  FROM users u
  WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. VIEW ДЛЯ ЛИДЕРБОРДА
-- ============================================

CREATE OR REPLACE VIEW streak_leaderboard AS
SELECT
  u.id as user_id,
  u.telegram_id,
  u.first_name,
  u.username,
  u.current_streak,
  u.longest_streak,
  u.total_logs_count,
  u.last_log_date,
  COUNT(ua.id) as total_achievements
FROM users u
LEFT JOIN user_achievements ua ON ua.user_id = u.id
WHERE u.current_streak > 0
GROUP BY u.id
ORDER BY u.current_streak DESC, u.longest_streak DESC
LIMIT 100;

-- ============================================
-- 6. КОММЕНТАРИИ
-- ============================================

COMMENT ON COLUMN users.current_streak IS 'Текущая серия дней подряд с логированием еды';
COMMENT ON COLUMN users.longest_streak IS 'Лучшая серия дней подряд за все время';
COMMENT ON COLUMN users.last_log_date IS 'Дата последнего логирования еды';
COMMENT ON COLUMN users.total_logs_count IS 'Общее количество логов еды за все время';

COMMENT ON TABLE user_achievements IS 'Достижения пользователей (бейджи, награды)';
COMMENT ON FUNCTION update_user_streak IS 'Обновляет streak пользователя при логировании еды. Возвращает новые достижения.';
COMMENT ON FUNCTION get_user_streak_stats IS 'Получает полную статистику streak пользователя включая достижения';
COMMENT ON VIEW streak_leaderboard IS 'Топ-100 пользователей по текущему streak';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Обновить streak пользователя:
-- SELECT * FROM update_user_streak(42);
--
-- 2. Получить статистику streak:
-- SELECT * FROM get_user_streak_stats(42);
--
-- 3. Посмотреть лидерборд:
-- SELECT * FROM streak_leaderboard LIMIT 10;
--
-- 4. Посмотреть все достижения пользователя:
-- SELECT * FROM user_achievements WHERE user_id = 42;
-- ============================================
