-- Схема базы данных для монетизации и подписок
-- C.I.D. Bot - Subscription System

-- Таблица планов подписки
CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    duration_days INTEGER NOT NULL,
    price_amount DECIMAL(10,2) NOT NULL,
    price_currency VARCHAR(3) DEFAULT 'RUB',
    is_active BOOLEAN DEFAULT true,
    features JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица подписок пользователей
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id BIGINT REFERENCES subscription_plans(id),
    status VARCHAR(20) NOT NULL, -- 'trial', 'active', 'expired', 'cancelled'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_trial BOOLEAN DEFAULT false,
    payment_id VARCHAR(255),
    payment_provider VARCHAR(50),
    auto_renew BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT user_subscriptions_status_check CHECK (status IN ('trial', 'active', 'expired', 'cancelled'))
);

-- Таблица платежей
CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id BIGINT REFERENCES user_subscriptions(id),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'RUB',
    status VARCHAR(20) NOT NULL, -- 'pending', 'completed', 'failed', 'refunded'
    payment_provider VARCHAR(50),
    payment_id VARCHAR(255),
    payment_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT payments_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))
);

-- Таблица истории использования (для аналитики)
CREATE TABLE IF NOT EXISTS usage_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- 'food_log', 'recipe_request', 'plan_update', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires_at ON user_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);

-- Добавляем UNIQUE constraint на name
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'subscription_plans_name_key'
  ) THEN
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_name_key UNIQUE (name);
  END IF;
END $$;

-- Вставка стандартных планов подписки
INSERT INTO subscription_plans (name, duration_days, price_amount, price_currency, features) VALUES
('trial', 7, 0.00, 'RUB', '{"name": "Пробный период", "description": "7 дней бесплатно", "limits": {"food_logs_per_day": 10, "recipe_requests_per_day": 5}}'),
('monthly', 30, 78.00, 'RUB', '{"name": "Месячная подписка", "description": "1 месяц", "limits": null}'),
('quarterly', 90, 178.00, 'RUB', '{"name": "Квартальная подписка", "description": "3 месяца", "discount": "22%", "limits": null}'),
('yearly', 365, 878.00, 'RUB', '{"name": "Годовая подписка", "description": "12 месяцев", "discount": "44%", "limits": null}')
ON CONFLICT (name) DO NOTHING;

-- Функция для проверки активной подписки
DROP FUNCTION IF EXISTS check_subscription_status(BIGINT);
CREATE OR REPLACE FUNCTION check_subscription_status(p_user_id BIGINT)
RETURNS TABLE (
    has_active_subscription BOOLEAN,
    subscription_status VARCHAR(20),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_trial BOOLEAN,
    days_remaining INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN us.status IN ('trial', 'active') AND us.expires_at > NOW() THEN true
            ELSE false
        END as has_active_subscription,
        us.status,
        us.expires_at,
        us.is_trial,
        EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER as days_remaining
    FROM user_subscriptions us
    WHERE us.user_id = p_user_id
    ORDER BY us.expires_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Функция для автоматического истечения подписок
CREATE OR REPLACE FUNCTION expire_subscriptions()
RETURNS void AS $$
BEGIN
    UPDATE user_subscriptions
    SET status = 'expired',
        updated_at = NOW()
    WHERE status IN ('trial', 'active')
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Комментарии к таблицам
COMMENT ON TABLE subscription_plans IS 'Планы подписки (триал, 1 мес, 3 мес, 12 мес)';
COMMENT ON TABLE user_subscriptions IS 'Подписки пользователей с триалом и статусами';
COMMENT ON TABLE payments IS 'История платежей и транзакций';
COMMENT ON TABLE usage_logs IS 'Логи использования для аналитики и лимитов';


