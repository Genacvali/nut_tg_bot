-- Таблица для хранения настроек уведомлений пользователей
CREATE TABLE IF NOT EXISTS notification_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Настройки уведомлений о еде
  food_notifications_enabled BOOLEAN DEFAULT true,
  food_notification_start_time TIME DEFAULT '09:00:00',
  food_notification_end_time TIME DEFAULT '22:00:00',
  food_notification_count INT DEFAULT 4, -- Количество напоминаний о еде в день
  
  -- Настройки уведомлений о воде
  water_notifications_enabled BOOLEAN DEFAULT true,
  water_notification_start_time TIME DEFAULT '08:00:00',
  water_notification_end_time TIME DEFAULT '22:00:00',
  water_notification_interval_minutes INT DEFAULT 90, -- Каждые 90 минут
  
  -- Часовой пояс пользователя (по умолчанию Moscow)
  timezone TEXT DEFAULT 'Europe/Moscow',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Таблица для отслеживания отправленных уведомлений (чтобы не дублировать)
CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'food' или 'water'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска в notification_logs
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_sent ON notification_logs(user_id, sent_at);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_notification_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления updated_at
CREATE TRIGGER trigger_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_settings_updated_at();

-- Создание настроек по умолчанию для существующих пользователей
INSERT INTO notification_settings (user_id)
SELECT id FROM users
WHERE id NOT IN (SELECT user_id FROM notification_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Включаем Row Level Security
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- Политики доступа для notification_settings
-- Примечание: Так как мы используем service_role_key для Edge Functions,
-- эти политики будут применяться только при прямом доступе через API
CREATE POLICY "Service role can manage notification settings"
  ON notification_settings FOR ALL
  USING (true)
  WITH CHECK (true);

-- Политики доступа для notification_logs
CREATE POLICY "Service role can manage notification logs"
  ON notification_logs FOR ALL
  USING (true)
  WITH CHECK (true);

