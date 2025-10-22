-- Таблица для данных Apple Watch / Apple Health

CREATE TABLE IF NOT EXISTS health_data (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Физические параметры
  weight DECIMAL(5,2),
  
  -- Активность
  steps INTEGER,
  active_calories INTEGER,
  workout_minutes INTEGER,
  
  -- Сон
  sleep_hours DECIMAL(4,2),
  
  -- Другое
  water_ml INTEGER,
  heart_rate_avg INTEGER,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Один набор данных на пользователя на день
  UNIQUE(user_id, date)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_health_data_user_date ON health_data(user_id, date DESC);

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_health_data_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS trigger_health_data_updated_at ON health_data;
CREATE TRIGGER trigger_health_data_updated_at
  BEFORE UPDATE ON health_data
  FOR EACH ROW
  EXECUTE FUNCTION update_health_data_updated_at();
