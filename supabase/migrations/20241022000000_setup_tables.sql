-- Создание таблицы пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    calories_goal INTEGER DEFAULT 2000,
    protein_goal DECIMAL(5,2) DEFAULT 150.0,
    carbs_goal DECIMAL(5,2) DEFAULT 200.0,
    fat_goal DECIMAL(5,2) DEFAULT 70.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание таблицы приемов пищи
CREATE TABLE meals (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    meal_name VARCHAR(255) NOT NULL,
    calories INTEGER NOT NULL,
    protein DECIMAL(5,2) NOT NULL,
    carbs DECIMAL(5,2) NOT NULL,
    fat DECIMAL(5,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Создание таблицы проверок веса и самочувствия
CREATE TABLE checkins (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    weight DECIMAL(5,2),
    notes TEXT,
    mood VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Создание индексов для оптимизации запросов
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_meals_user_id ON meals(user_id);
CREATE INDEX idx_meals_created_at ON meals(created_at);
CREATE INDEX idx_checkins_user_id ON checkins(user_id);

-- Включение Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

-- Политики безопасности для анонимного доступа (для тестирования)
CREATE POLICY "Allow anonymous access to users" ON users FOR ALL USING (true);
CREATE POLICY "Allow anonymous access to meals" ON meals FOR ALL USING (true);
CREATE POLICY "Allow anonymous access to checkins" ON checkins FOR ALL USING (true);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at в таблице users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
