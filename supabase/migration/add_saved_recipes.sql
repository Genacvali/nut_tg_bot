-- ============================================
-- SAVED RECIPES: СОХРАНЕННЫЕ РЕЦЕПТЫ ОТ AI
-- ============================================
-- Дата: 2025-10-28
-- Описание: Добавляем возможность сохранять рецепты и рационы от AI-ассистента
-- Цель: Пользователи могут сохранять понравившиеся рецепты для повторного использования
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА СОХРАНЕННЫХ РЕЦЕПТОВ
-- ============================================

CREATE TABLE IF NOT EXISTS saved_recipes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Название рецепта/рациона (придумывает пользователь)
  name VARCHAR(255) NOT NULL,

  -- Полный текст рецепта от AI
  content TEXT NOT NULL,

  -- КБЖУ (опционально, извлекается из текста)
  calories INT,
  protein INT,
  fats INT,
  carbs INT,

  -- Флаг: это рацион на день (несколько приемов) или один рецепт
  is_meal_plan BOOLEAN DEFAULT FALSE,

  -- Счетчик просмотров
  view_count INT DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_saved_recipes_user_id ON saved_recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_recipes_user_created ON saved_recipes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_recipes_is_meal_plan ON saved_recipes(user_id, is_meal_plan);

-- Trigger для автообновления updated_at
CREATE OR REPLACE FUNCTION update_saved_recipes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_saved_recipes_updated_at
  BEFORE UPDATE ON saved_recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_recipes_updated_at();

-- ============================================
-- 2. КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE saved_recipes IS 'Сохраненные рецепты и рационы от AI-ассистента';
COMMENT ON COLUMN saved_recipes.name IS 'Название рецепта, которое придумал пользователь';
COMMENT ON COLUMN saved_recipes.content IS 'Полный текст рецепта от AI с инструкциями';
COMMENT ON COLUMN saved_recipes.is_meal_plan IS 'TRUE = рацион на день (несколько приемов), FALSE = один рецепт';

-- ============================================
-- ТЕСТИРОВАНИЕ
-- ============================================
--
-- 1. Сохранить рецепт:
-- INSERT INTO saved_recipes (user_id, name, content, calories, protein, fats, carbs)
-- VALUES (42, 'Овсянка с бананом', 'Рецепт от AI...', 350, 12, 8, 55);
--
-- 2. Получить рецепты пользователя:
-- SELECT * FROM saved_recipes WHERE user_id = 42 ORDER BY created_at DESC;
--
-- 3. Удалить рецепт:
-- DELETE FROM saved_recipes WHERE id = 1 AND user_id = 42;
-- ============================================
