-- ========================================
-- БЫСТРАЯ УСТАНОВКА ПОДПИСОЧНОЙ СИСТЕМЫ
-- Выполни этот файл в Supabase SQL Editor
-- ========================================

-- ШАГ 1: Создание базовых таблиц
-- ========================================

-- Таблица планов подписки
CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
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
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_trial BOOLEAN DEFAULT false,
    is_unlimited BOOLEAN DEFAULT false,
    granted_by_admin_id BIGINT REFERENCES users(id),
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
    status VARCHAR(20) NOT NULL,
    payment_provider VARCHAR(50),
    payment_id VARCHAR(255),
    payment_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT payments_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires_at ON user_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Unique constraint для активных подписок
DROP INDEX IF EXISTS idx_user_active_subscription;
CREATE UNIQUE INDEX idx_user_active_subscription 
ON user_subscriptions(user_id) 
WHERE status IN ('trial', 'active');

-- Добавить поле is_admin если его нет
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Добавить новые поля в user_subscriptions если их нет
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN DEFAULT false;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS granted_by_admin_id BIGINT REFERENCES users(id);

-- ШАГ 2: Добавляем UNIQUE constraint на name
-- ========================================

-- Сначала удаляем дубликаты если есть
DELETE FROM subscription_plans a USING subscription_plans b
WHERE a.id > b.id AND a.name = b.name;

-- Добавляем UNIQUE constraint
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'subscription_plans_name_key'
  ) THEN
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_name_key UNIQUE (name);
  END IF;
END $$;

-- ШАГ 3: Вставка планов подписки
-- ========================================

INSERT INTO subscription_plans (name, duration_days, price_amount, price_currency, features) VALUES
('trial', 7, 0.00, 'RUB', '{"name": "Пробный период", "description": "7 дней бесплатно", "limits": {"food_logs_per_day": 10, "recipe_requests_per_day": 5}}'),
('monthly', 30, 78.00, 'RUB', '{"name": "Месячная подписка", "description": "1 месяц", "limits": null}'),
('quarterly', 90, 178.00, 'RUB', '{"name": "Квартальная подписка", "description": "3 месяца", "discount": "22%", "limits": null}'),
('yearly', 365, 878.00, 'RUB', '{"name": "Годовая подписка", "description": "12 месяцев", "discount": "44%", "limits": null}'),
('unlimited', 36500, 0.00, 'RUB', '{"name": "Безлимитная подписка", "description": "Навсегда бесплатно (подарок от администрации)", "limits": null, "is_gift": true}')
ON CONFLICT (name) DO UPDATE SET
  duration_days = EXCLUDED.duration_days,
  price_amount = EXCLUDED.price_amount,
  features = EXCLUDED.features;

-- ШАГ 4: Функции
-- ========================================

-- Автоматическое создание trial при заполнении профиля
CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER AS $$
DECLARE
  trial_plan_id BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_subscriptions WHERE user_id = NEW.user_id) THEN
    SELECT id INTO trial_plan_id FROM subscription_plans WHERE name = 'trial' LIMIT 1;
    
    INSERT INTO user_subscriptions (
      user_id, plan_id, status, started_at, expires_at, is_trial
    ) VALUES (
      NEW.user_id, trial_plan_id, 'trial', NOW(), NOW() + INTERVAL '7 days', true
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_trial ON user_profiles;
CREATE TRIGGER trigger_create_trial
  AFTER INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_trial_subscription();

-- Выдача unlimited подписки
CREATE OR REPLACE FUNCTION grant_unlimited_subscription(
  p_user_id BIGINT,
  p_admin_id BIGINT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  unlimited_plan_id BIGINT;
  new_subscription_id BIGINT;
BEGIN
  SELECT id INTO unlimited_plan_id FROM subscription_plans WHERE name = 'unlimited' LIMIT 1;
  
  UPDATE user_subscriptions
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id AND status IN ('trial', 'active');
  
  INSERT INTO user_subscriptions (
    user_id, plan_id, status, started_at, expires_at, is_trial, is_unlimited, granted_by_admin_id
  ) VALUES (
    p_user_id, unlimited_plan_id, 'active', NOW(), NOW() + INTERVAL '100 years', false, true, p_admin_id
  )
  RETURNING id INTO new_subscription_id;
  
  RETURN new_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- Создание платной подписки
CREATE OR REPLACE FUNCTION create_paid_subscription(
  p_user_id BIGINT,
  p_plan_name TEXT,
  p_payment_id TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  plan_record RECORD;
  new_subscription_id BIGINT;
BEGIN
  SELECT * INTO plan_record FROM subscription_plans WHERE name = p_plan_name LIMIT 1;
  
  IF plan_record IS NULL THEN
    RAISE EXCEPTION 'Plan % not found', p_plan_name;
  END IF;
  
  UPDATE user_subscriptions
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id AND status = 'trial';
  
  INSERT INTO user_subscriptions (
    user_id, plan_id, status, started_at, expires_at, is_trial, payment_id
  ) VALUES (
    p_user_id, plan_record.id, 'active', NOW(), 
    NOW() + (plan_record.duration_days || ' days')::INTERVAL, false, p_payment_id
  )
  RETURNING id INTO new_subscription_id;
  
  RETURN new_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- Проверка статуса подписки
DROP FUNCTION IF EXISTS check_subscription_status(BIGINT);
CREATE OR REPLACE FUNCTION check_subscription_status(p_user_id BIGINT)
RETURNS TABLE (
    has_active_subscription BOOLEAN,
    subscription_status VARCHAR(20),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_trial BOOLEAN,
    is_unlimited BOOLEAN,
    days_remaining INTEGER,
    plan_name TEXT,
    needs_payment BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE WHEN us.status IN ('trial', 'active') AND us.expires_at > NOW() THEN true ELSE false END,
        us.status,
        us.expires_at,
        us.is_trial,
        COALESCE(us.is_unlimited, false),
        EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER,
        sp.name,
        CASE WHEN us.status = 'expired' OR (us.status = 'trial' AND us.expires_at < NOW()) THEN true ELSE false END
    FROM user_subscriptions us
    LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = p_user_id
    ORDER BY us.expires_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Получение информации о подписке
DROP FUNCTION IF EXISTS get_subscription_info(BIGINT);
CREATE OR REPLACE FUNCTION get_subscription_info(p_user_id BIGINT)
RETURNS TABLE (
    status_emoji TEXT,
    status_text TEXT,
    expires_text TEXT,
    plan_description TEXT,
    action_needed TEXT
) AS $$
DECLARE
    sub RECORD;
BEGIN
    SELECT * INTO sub FROM check_subscription_status(p_user_id);
    
    IF sub IS NULL OR NOT sub.has_active_subscription THEN
        RETURN QUERY SELECT '🔒'::TEXT, 'Подписка истекла'::TEXT, 'Требуется оплата'::TEXT, 
                           'Выбери план подписки'::TEXT, 'buy_subscription'::TEXT;
    ELSIF sub.is_unlimited THEN
        RETURN QUERY SELECT '👑'::TEXT, 'Безлимитная подписка'::TEXT, '♾️ Навсегда'::TEXT, 
                           'Подарок от администрации'::TEXT, NULL::TEXT;
    ELSIF sub.is_trial THEN
        RETURN QUERY SELECT '🎁'::TEXT, 'Пробный период'::TEXT, 
                           FORMAT('%s дней осталось', sub.days_remaining)::TEXT,
                           'Полный доступ бесплатно'::TEXT,
                           CASE WHEN sub.days_remaining <= 2 THEN 'trial_ending' ELSE NULL END::TEXT;
    ELSE
        RETURN QUERY SELECT '✅'::TEXT, 'Активная подписка'::TEXT, 
                           FORMAT('%s дней осталось', sub.days_remaining)::TEXT,
                           (SELECT features->>'name' FROM subscription_plans WHERE name = sub.plan_name)::TEXT,
                           CASE WHEN sub.days_remaining <= 3 THEN 'renew_soon' ELSE NULL END::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Автоистечение подписок
CREATE OR REPLACE FUNCTION expire_subscriptions()
RETURNS void AS $$
BEGIN
    UPDATE user_subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE status IN ('trial', 'active') AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ШАГ 5: View для аналитики
-- ========================================

CREATE OR REPLACE VIEW subscription_analytics AS
SELECT 
    u.telegram_id,
    u.username,
    us.status,
    us.is_trial,
    us.is_unlimited,
    us.started_at,
    us.expires_at,
    EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER as days_remaining,
    sp.name as plan_name,
    sp.price_amount,
    us.granted_by_admin_id,
    u.created_at as user_created_at
FROM users u
LEFT JOIN user_subscriptions us ON us.user_id = u.id AND us.status IN ('trial', 'active')
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
ORDER BY us.expires_at ASC NULLS LAST;

-- ========================================
-- ПРОВЕРКА УСТАНОВКИ
-- ========================================

-- Посмотреть планы
SELECT * FROM subscription_plans;

-- Посмотреть подписки
SELECT * FROM subscription_analytics;

-- Статистика
SELECT 
    COALESCE(sp.name, 'no_subscription') as plan,
    COUNT(*) as user_count,
    SUM(CASE WHEN us.status = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN us.is_trial THEN 1 ELSE 0 END) as trial,
    SUM(CASE WHEN us.is_unlimited THEN 1 ELSE 0 END) as unlimited
FROM users u
LEFT JOIN user_subscriptions us ON us.user_id = u.id AND us.status IN ('trial', 'active')
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
GROUP BY sp.name;

-- ========================================
-- ✅ ГОТОВО!
-- ========================================
-- Следующий шаг: интеграция с ботом (см. SUBSCRIPTION_SETUP_GUIDE.md)

