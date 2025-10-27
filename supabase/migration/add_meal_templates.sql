-- ============================================
-- QUICK LOG: ШАБЛОНЫ ЕДЫ (MEAL TEMPLATES)
-- ============================================
-- Дата: 2025-10-27
-- Описание: Добавляем возможность сохранять частые блюда для быстрого логирования
-- Цель: Уменьшить friction при логировании → больше пользователей логируют
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА ШАБЛОНОВ ЕДЫ
-- ============================================

CREATE TABLE IF NOT EXISTS user_meal_templates (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Название шаблона (например "Мой завтрак", "Стандартный обед")
  template_name VARCHAR(255) NOT NULL,

  -- Описание еды (то что было в food_log)
  description TEXT NOT NULL,

  -- КБЖУ
  calories DECIMAL(8,2) NOT NULL,
  protein DECIMAL(6,2) NOT NULL,
  fats DECIMAL(6,2) NOT NULL,
  carbs DECIMAL(6,2) NOT NULL,

  -- Тип приема пищи (опционально)
  meal_type VARCHAR(20), -- 'breakfast', 'lunch', 'dinner', 'snack'

  -- Иконка/эмодзи для визуализации
  emoji VARCHAR(10) DEFAULT '🍽️',

  -- Счетчик использований
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Уникальность: один пользователь не может иметь 2 шаблона с одинаковым именем
  UNIQUE(user_id, template_name)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_meal_templates_user_id ON user_meal_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_templates_user_use_count ON user_meal_templates(user_id, use_count DESC);
CREATE INDEX IF NOT EXISTS idx_meal_templates_meal_type ON user_meal_templates(user_id, meal_type);

-- Trigger для автообновления updated_at
CREATE OR REPLACE FUNCTION update_meal_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_meal_templates_updated_at
  BEFORE UPDATE ON user_meal_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_meal_templates_updated_at();

-- ============================================
-- 2. ФУНКЦИЯ: Создать шаблон из food_log
-- ============================================

CREATE OR REPLACE FUNCTION create_meal_template_from_log(
  p_user_id BIGINT,
  p_food_log_id BIGINT,
  p_template_name VARCHAR(255),
  p_emoji VARCHAR(10) DEFAULT '🍽️'
)
RETURNS JSONB AS $$
DECLARE
  v_food_log RECORD;
  v_template_id BIGINT;
BEGIN
  -- Получаем food_log
  SELECT * INTO v_food_log
  FROM food_logs
  WHERE id = p_food_log_id AND user_id = p_user_id;

  IF v_food_log IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Food log not found'
    );
  END IF;

  -- Создаем шаблон
  INSERT INTO user_meal_templates (
    user_id,
    template_name,
    description,
    calories,
    protein,
    fats,
    carbs,
    meal_type,
    emoji
  )
  VALUES (
    p_user_id,
    p_template_name,
    v_food_log.description,
    v_food_log.calories,
    v_food_log.protein,
    v_food_log.fats,
    v_food_log.carbs,
    v_food_log.meal_type,
    p_emoji
  )
  ON CONFLICT (user_id, template_name) DO UPDATE
  SET
    description = EXCLUDED.description,
    calories = EXCLUDED.calories,
    protein = EXCLUDED.protein,
    fats = EXCLUDED.fats,
    carbs = EXCLUDED.carbs,
    meal_type = EXCLUDED.meal_type,
    emoji = EXCLUDED.emoji,
    updated_at = NOW()
  RETURNING id INTO v_template_id;

  RETURN jsonb_build_object(
    'success', true,
    'template_id', v_template_id,
    'template_name', p_template_name
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. ФУНКЦИЯ: Использовать шаблон (создать food_log)
-- ============================================

CREATE OR REPLACE FUNCTION use_meal_template(
  p_user_id BIGINT,
  p_template_id BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_template RECORD;
  v_food_log_id BIGINT;
BEGIN
  -- Получаем шаблон
  SELECT * INTO v_template
  FROM user_meal_templates
  WHERE id = p_template_id AND user_id = p_user_id;

  IF v_template IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Template not found'
    );
  END IF;

  -- Создаем food_log
  INSERT INTO food_logs (
    user_id,
    description,
    calories,
    protein,
    fats,
    carbs,
    meal_type,
    logged_at
  )
  VALUES (
    p_user_id,
    v_template.description,
    v_template.calories,
    v_template.protein,
    v_template.fats,
    v_template.carbs,
    v_template.meal_type,
    NOW()
  )
  RETURNING id INTO v_food_log_id;

  -- Обновляем статистику использования шаблона
  UPDATE user_meal_templates
  SET
    use_count = use_count + 1,
    last_used_at = NOW()
  WHERE id = p_template_id;

  RETURN jsonb_build_object(
    'success', true,
    'food_log_id', v_food_log_id,
    'template_name', v_template.template_name,
    'calories', v_template.calories,
    'protein', v_template.protein,
    'fats', v_template.fats,
    'carbs', v_template.carbs
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. ФУНКЦИЯ: Получить все шаблоны пользователя
-- ============================================

CREATE OR REPLACE FUNCTION get_user_meal_templates(
  p_user_id BIGINT,
  p_meal_type VARCHAR(20) DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  id BIGINT,
  template_name VARCHAR(255),
  description TEXT,
  calories DECIMAL(8,2),
  protein DECIMAL(6,2),
  fats DECIMAL(6,2),
  carbs DECIMAL(6,2),
  meal_type VARCHAR(20),
  emoji VARCHAR(10),
  use_count INT,
  last_used_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.template_name,
    t.description,
    t.calories,
    t.protein,
    t.fats,
    t.carbs,
    t.meal_type,
    t.emoji,
    t.use_count,
    t.last_used_at
  FROM user_meal_templates t
  WHERE t.user_id = p_user_id
    AND (p_meal_type IS NULL OR t.meal_type = p_meal_type)
  ORDER BY t.use_count DESC, t.last_used_at DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. ФУНКЦИЯ: Удалить шаблон
-- ============================================

CREATE OR REPLACE FUNCTION delete_meal_template(
  p_user_id BIGINT,
  p_template_id BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  DELETE FROM user_meal_templates
  WHERE id = p_template_id AND user_id = p_user_id
  RETURNING TRUE INTO v_deleted;

  RETURN COALESCE(v_deleted, FALSE);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. VIEW: Популярные блюда среди всех пользователей
-- ============================================

CREATE OR REPLACE VIEW popular_meal_templates AS
SELECT
  template_name,
  description,
  ROUND(AVG(calories), 0) as avg_calories,
  ROUND(AVG(protein), 1) as avg_protein,
  ROUND(AVG(fats), 1) as avg_fats,
  ROUND(AVG(carbs), 1) as avg_carbs,
  meal_type,
  emoji,
  COUNT(DISTINCT user_id) as users_count,
  SUM(use_count) as total_uses
FROM user_meal_templates
GROUP BY template_name, description, meal_type, emoji
HAVING COUNT(DISTINCT user_id) >= 3  -- минимум 3 пользователя используют
ORDER BY total_uses DESC
LIMIT 50;

-- ============================================
-- 7. КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE user_meal_templates IS 'Шаблоны частых блюд пользователей для быстрого логирования';
COMMENT ON FUNCTION create_meal_template_from_log IS 'Создает шаблон на основе существующего food_log';
COMMENT ON FUNCTION use_meal_template IS 'Использует шаблон - создает новый food_log и обновляет статистику';
COMMENT ON FUNCTION get_user_meal_templates IS 'Получает список шаблонов пользователя, отсортированных по популярности';
COMMENT ON FUNCTION delete_meal_template IS 'Удаляет шаблон пользователя';
COMMENT ON VIEW popular_meal_templates IS 'Топ-50 популярных блюд среди всех пользователей';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Создать шаблон из food_log:
-- SELECT create_meal_template_from_log(42, 123, 'Мой завтрак', '☕️');
--
-- 2. Получить шаблоны пользователя:
-- SELECT * FROM get_user_meal_templates(42);
--
-- 3. Использовать шаблон:
-- SELECT * FROM use_meal_template(42, 1);
--
-- 4. Удалить шаблон:
-- SELECT delete_meal_template(42, 1);
--
-- 5. Популярные блюда:
-- SELECT * FROM popular_meal_templates;
-- ============================================
