-- Чистая миграция для рефакторинга проекта
-- Удаляет старые таблицы и создаёт новые с правильной структурой

BEGIN;

-- ============================================================================
-- 1. УДАЛЕНИЕ СТАРЫХ ТАБЛИЦ
-- ============================================================================

DROP TABLE IF EXISTS events_log CASCADE;
DROP TABLE IF EXISTS state CASCADE;
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS daily_totals CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS preferences CASCADE;

-- ============================================================================
-- 2. ОБНОВЛЕНИЕ ТАБЛИЦЫ USERS
-- ============================================================================

-- Удаляем старые constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_activity_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_goal_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_sex_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tone_check;

-- Удаляем старые поля
ALTER TABLE users DROP COLUMN IF EXISTS age;
ALTER TABLE users DROP COLUMN IF EXISTS sex;
ALTER TABLE users DROP COLUMN IF EXISTS height_cm;
ALTER TABLE users DROP COLUMN IF EXISTS weight_kg;
ALTER TABLE users DROP COLUMN IF EXISTS activity;
ALTER TABLE users DROP COLUMN IF EXISTS goal;
ALTER TABLE users DROP COLUMN IF EXISTS tz;
ALTER TABLE users DROP COLUMN IF EXISTS language;
ALTER TABLE users DROP COLUMN IF EXISTS tone;

-- Добавляем новые поля
ALTER TABLE users 
ADD COLUMN age SMALLINT,
ADD COLUMN sex TEXT,
ADD COLUMN height_cm NUMERIC(5,1),
ADD COLUMN weight_kg NUMERIC(5,1),
ADD COLUMN activity TEXT,
ADD COLUMN goal TEXT,
ADD COLUMN tz TEXT DEFAULT 'Europe/Moscow',
ADD COLUMN language TEXT DEFAULT 'ru',
ADD COLUMN tone TEXT DEFAULT 'mentor';

-- Переносим данные из старых полей
UPDATE users SET height_cm = height WHERE height IS NOT NULL;
UPDATE users SET weight_kg = weight WHERE weight IS NOT NULL;

-- Удаляем старые поля height и weight
ALTER TABLE users DROP COLUMN IF EXISTS height;
ALTER TABLE users DROP COLUMN IF EXISTS weight;

-- Обновляем значения активности
UPDATE users SET activity = 'moderate' WHERE activity = 'medium';
UPDATE users SET activity = 'sedentary' WHERE activity NOT IN ('sedentary','light','moderate','high','very_high') AND activity IS NOT NULL;

-- Обновляем значения цели
UPDATE users SET goal = 'fat_loss' WHERE goal = 'lose';
UPDATE users SET goal = 'maintain' WHERE goal NOT IN ('fat_loss','maintain','gain') AND goal IS NOT NULL;

-- Добавляем constraints
ALTER TABLE users ADD CONSTRAINT users_sex_check CHECK (sex IS NULL OR sex IN ('male','female'));
ALTER TABLE users ADD CONSTRAINT users_activity_check CHECK (activity IS NULL OR activity IN ('sedentary','light','moderate','high','very_high'));
ALTER TABLE users ADD CONSTRAINT users_goal_check CHECK (goal IS NULL OR goal IN ('fat_loss','maintain','gain'));
ALTER TABLE users ADD CONSTRAINT users_tone_check CHECK (tone IN ('coach','mentor','neutral'));

-- ============================================================================
-- 3. ОБНОВЛЕНИЕ ТАБЛИЦЫ MEALS
-- ============================================================================

-- Удаляем старые триггеры
DROP TRIGGER IF EXISTS trigger_recalculate_daily_totals_insert ON meals;
DROP TRIGGER IF EXISTS trigger_recalculate_daily_totals_update ON meals;
DROP TRIGGER IF EXISTS trigger_recalculate_daily_totals_delete ON meals;
DROP FUNCTION IF EXISTS recalculate_daily_totals() CASCADE;

-- Добавляем новые поля
ALTER TABLE meals 
ADD COLUMN IF NOT EXISTS note_text TEXT,
ADD COLUMN IF NOT EXISTS kcal INTEGER,
ADD COLUMN IF NOT EXISTS meal_type TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
ADD COLUMN IF NOT EXISTS ts TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Переносим данные из calories в kcal
UPDATE meals SET kcal = calories WHERE calories IS NOT NULL AND kcal IS NULL;
ALTER TABLE meals DROP COLUMN IF EXISTS calories;

-- Обновляем ts из created_at
UPDATE meals SET ts = created_at WHERE ts IS NULL;

-- Создаём индекс
CREATE INDEX IF NOT EXISTS idx_meals_user_ts ON meals(user_id, ts);

-- ============================================================================
-- 4. СОЗДАНИЕ ТАБЛИЦЫ PLANS
-- ============================================================================

CREATE TABLE plans (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    kcal INTEGER NOT NULL,
    p NUMERIC(5,1) NOT NULL,
    f NUMERIC(5,1) NOT NULL,
    c NUMERIC(5,1) NOT NULL,
    rules_json JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    source TEXT CHECK (source IN ('auto','manual')) DEFAULT 'auto',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_plans_user_id ON plans(user_id);
CREATE INDEX idx_plans_user_active ON plans(user_id, is_active);
CREATE INDEX idx_plans_created_at ON plans(created_at);
CREATE UNIQUE INDEX idx_plans_user_active_unique ON plans(user_id) WHERE is_active = true;

-- ============================================================================
-- 5. СОЗДАНИЕ ТАБЛИЦЫ PREFERENCES
-- ============================================================================

CREATE TABLE preferences (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    diet TEXT CHECK (diet IN ('default','hi_protein','low_carb','vegetarian','keto')) DEFAULT 'default',
    dislikes TEXT,
    allergies TEXT,
    eat_window_start TIME,
    eat_window_end TIME,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX idx_preferences_user_id ON preferences(user_id);

-- ============================================================================
-- 6. СОЗДАНИЕ ТАБЛИЦЫ DAILY_TOTALS
-- ============================================================================

CREATE TABLE daily_totals (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    kcal INTEGER DEFAULT 0,
    p INTEGER DEFAULT 0,
    f INTEGER DEFAULT 0,
    c INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_totals_user_date ON daily_totals(user_id, date);
CREATE INDEX idx_daily_totals_date ON daily_totals(date);

-- ============================================================================
-- 7. СОЗДАНИЕ ТАБЛИЦЫ REMINDERS
-- ============================================================================

CREATE TABLE reminders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    kind TEXT CHECK (kind IN ('day_report','meal','weigh')) NOT NULL,
    time_local TIME NOT NULL,
    is_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reminders_user_id ON reminders(user_id);
CREATE INDEX idx_reminders_kind_enabled ON reminders(kind, is_enabled);
CREATE INDEX idx_reminders_user_kind_enabled ON reminders(user_id, kind, is_enabled);

-- ============================================================================
-- 8. СОЗДАНИЕ ТАБЛИЦЫ STATE
-- ============================================================================

CREATE TABLE state (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    last_menu TEXT,
    last_msgs_json JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX idx_state_user_id ON state(user_id);

-- ============================================================================
-- 9. СОЗДАНИЕ ТАБЛИЦЫ EVENTS_LOG
-- ============================================================================

CREATE TABLE events_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    meta_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_log_user_id ON events_log(user_id);
CREATE INDEX idx_events_log_event ON events_log(event);
CREATE INDEX idx_events_log_created_at ON events_log(created_at);
CREATE INDEX idx_events_log_user_event_date ON events_log(user_id, event, created_at);

-- ============================================================================
-- 10. ВКЛЮЧЕНИЕ RLS
-- ============================================================================

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE state ENABLE ROW LEVEL SECURITY;
ALTER TABLE events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON plans FOR ALL USING (true);
CREATE POLICY "Allow all access" ON preferences FOR ALL USING (true);
CREATE POLICY "Allow all access" ON daily_totals FOR ALL USING (true);
CREATE POLICY "Allow all access" ON reminders FOR ALL USING (true);
CREATE POLICY "Allow all access" ON state FOR ALL USING (true);
CREATE POLICY "Allow all access" ON events_log FOR ALL USING (true);

-- ============================================================================
-- 11. МИГРАЦИЯ ДАННЫХ
-- ============================================================================

-- Создаём планы для существующих пользователей
INSERT INTO plans (user_id, kcal, p, f, c, source, is_active)
SELECT 
    user_id,
    COALESCE(calories_goal, 2000),
    COALESCE(protein_goal, 150),
    COALESCE(fat_goal, 70),
    COALESCE(carbs_goal, 200),
    'auto',
    true
FROM users
WHERE NOT EXISTS (
    SELECT 1 FROM plans p WHERE p.user_id = users.user_id AND p.is_active = true
);

-- Создаём предпочтения
INSERT INTO preferences (user_id, diet)
SELECT user_id, 'default'
FROM users
ON CONFLICT (user_id) DO NOTHING;

-- Создаём состояние
INSERT INTO state (user_id, last_menu, last_msgs_json)
SELECT 
    user_id,
    'main',
    COALESCE(conversation_context, '[]'::jsonb)
FROM users
ON CONFLICT (user_id) DO NOTHING;

-- Пересчитываем daily_totals
INSERT INTO daily_totals (user_id, date, kcal, p, f, c)
SELECT 
    user_id,
    COALESCE(ts::DATE, created_at::DATE) as date,
    SUM(COALESCE(kcal, 0)) as kcal,
    SUM(COALESCE(protein, 0)) as p,
    SUM(COALESCE(fat, 0)) as f,
    SUM(COALESCE(carbs, 0)) as c
FROM meals
WHERE COALESCE(kcal, 0) > 0
GROUP BY user_id, COALESCE(ts::DATE, created_at::DATE)
ON CONFLICT (user_id, date) 
DO UPDATE SET
    kcal = EXCLUDED.kcal,
    p = EXCLUDED.p,
    f = EXCLUDED.f,
    c = EXCLUDED.c,
    updated_at = NOW();

-- Создаём напоминания
INSERT INTO reminders (user_id, kind, time_local, is_enabled)
SELECT 
    user_id,
    'day_report',
    '21:00'::TIME,
    false
FROM users
WHERE NOT EXISTS (
    SELECT 1 FROM reminders r WHERE r.user_id = users.user_id AND r.kind = 'day_report'
);

-- Логируем миграцию
INSERT INTO events_log (event, meta_json)
VALUES ('migration', jsonb_build_object('version', 'refactor_v1', 'timestamp', NOW()::TEXT));

COMMIT;
