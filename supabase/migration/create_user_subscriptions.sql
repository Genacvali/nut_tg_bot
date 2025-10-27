-- ============================================
-- СОЗДАНИЕ ТАБЛИЦЫ USER_SUBSCRIPTIONS
-- ============================================
-- Таблица для хранения подписок пользователей
-- ============================================

-- Таблица планов подписки (уже существует, просто добавляем недостающие поля)
-- Сначала добавляем недостающие поля если их нет
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_usd DECIMAL(10,2);

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_rub DECIMAL(10,2);

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_amount DECIMAL(10,2);

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS price_currency VARCHAR(10) DEFAULT 'RUB';

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS features JSONB;

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Таблица подписок пользователей
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES subscription_plans(id),
  
  -- Статус подписки
  status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'expired', 'cancelled')),
  
  -- Временные метки
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- Флаги
  is_trial BOOLEAN DEFAULT FALSE,
  is_unlimited BOOLEAN DEFAULT FALSE,
  
  -- Админ который выдал подписку (если выдана вручную)
  granted_by_admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires_at ON user_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_is_unlimited ON user_subscriptions(is_unlimited);

-- Автоматическое обновление updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_subscriptions_updated_at 
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Обновляем существующие планы (если они есть)
UPDATE subscription_plans 
SET 
  price_amount = COALESCE(price_amount, price_rub, 129.00),
  price_rub = COALESCE(price_rub, 129.00),
  price_usd = COALESCE(price_usd, price_rub / 95),
  price_currency = COALESCE(price_currency, 'RUB'),
  is_active = COALESCE(is_active, TRUE)
WHERE name = 'monthly';

UPDATE subscription_plans 
SET 
  price_amount = COALESCE(price_amount, price_rub, 649.00),
  price_rub = COALESCE(price_rub, 649.00),
  price_usd = COALESCE(price_usd, price_rub / 95),
  price_currency = COALESCE(price_currency, 'RUB'),
  is_active = COALESCE(is_active, TRUE)
WHERE name = 'quarterly';

UPDATE subscription_plans 
SET 
  price_amount = COALESCE(price_amount, price_rub, 1099.00),
  price_rub = COALESCE(price_rub, 1099.00),
  price_usd = COALESCE(price_usd, price_rub / 95),
  price_currency = COALESCE(price_currency, 'RUB'),
  is_active = COALESCE(is_active, TRUE)
WHERE name = 'yearly';

-- Вставляем базовые планы если их нет
INSERT INTO subscription_plans (name, duration_days, price_amount, price_rub, price_usd, price_currency, is_active)
VALUES 
  ('monthly', 30, 129.00, 129.00, 1.36, 'RUB', TRUE),
  ('quarterly', 180, 649.00, 649.00, 6.83, 'RUB', TRUE),
  ('yearly', 365, 1099.00, 1099.00, 11.57, 'RUB', TRUE)
ON CONFLICT (name) DO NOTHING;

-- Комментарии
COMMENT ON TABLE user_subscriptions IS 'Подписки пользователей';
COMMENT ON TABLE subscription_plans IS 'Планы подписки';
COMMENT ON COLUMN user_subscriptions.status IS 'Статус: trial, active, expired, cancelled';
COMMENT ON COLUMN user_subscriptions.is_trial IS 'Является ли триальной подпиской';
COMMENT ON COLUMN user_subscriptions.is_unlimited IS 'Безлимитная подписка';

