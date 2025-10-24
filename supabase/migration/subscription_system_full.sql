-- ========================================
-- ПОЛНАЯ ПОДПИСОЧНАЯ СИСТЕМА
-- Trial 7 дней → Платная подписка или Unlimited (админ)
-- ========================================

-- Добавляем UNIQUE constraint на name если его нет
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'subscription_plans_name_key'
  ) THEN
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_name_key UNIQUE (name);
  END IF;
END $$;

-- Обновляем планы подписки (добавляем unlimited)
INSERT INTO subscription_plans (name, duration_days, price_amount, price_currency, features) VALUES
('unlimited', 36500, 0.00, 'RUB', '{"name": "Безлимитная подписка", "description": "Навсегда бесплатно (подарок от администрации)", "limits": null, "is_gift": true}')
ON CONFLICT (name) DO UPDATE SET
  duration_days = 36500,
  features = '{"name": "Безлимитная подписка", "description": "Навсегда бесплатно (подарок от администрации)", "limits": null, "is_gift": true}';

-- Добавляем поле для отслеживания unlimited
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS granted_by_admin_id BIGINT REFERENCES users(id);

-- Добавляем unique constraint для активных подписок
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_active_subscription 
ON user_subscriptions(user_id) 
WHERE status IN ('trial', 'active');

-- ========================================
-- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ TRIAL ПРИ ЗАПОЛНЕНИИ ПРОФИЛЯ
-- ========================================

CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER AS $$
DECLARE
  trial_plan_id BIGINT;
BEGIN
  -- Проверяем, есть ли уже подписка у пользователя
  IF NOT EXISTS (
    SELECT 1 FROM user_subscriptions 
    WHERE user_id = NEW.user_id
  ) THEN
    -- Получаем ID триального плана
    SELECT id INTO trial_plan_id 
    FROM subscription_plans 
    WHERE name = 'trial' 
    LIMIT 1;
    
    -- Создаем триальную подписку на 7 дней
    INSERT INTO user_subscriptions (
      user_id,
      plan_id,
      status,
      started_at,
      expires_at,
      is_trial
    ) VALUES (
      NEW.user_id,
      trial_plan_id,
      'trial',
      NOW(),
      NOW() + INTERVAL '7 days',
      true
    );
    
    RAISE NOTICE 'Trial subscription created for user %', NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер на создание профиля
DROP TRIGGER IF EXISTS trigger_create_trial ON user_profiles;
CREATE TRIGGER trigger_create_trial
  AFTER INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_trial_subscription();

-- ========================================
-- ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ПОДПИСКАМИ
-- ========================================

-- Функция для выдачи unlimited подписки (админ)
CREATE OR REPLACE FUNCTION grant_unlimited_subscription(
  p_user_id BIGINT,
  p_admin_id BIGINT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  unlimited_plan_id BIGINT;
  new_subscription_id BIGINT;
BEGIN
  -- Получаем ID unlimited плана
  SELECT id INTO unlimited_plan_id 
  FROM subscription_plans 
  WHERE name = 'unlimited' 
  LIMIT 1;
  
  -- Деактивируем все текущие подписки пользователя
  UPDATE user_subscriptions
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status IN ('trial', 'active');
  
  -- Создаем unlimited подписку
  INSERT INTO user_subscriptions (
    user_id,
    plan_id,
    status,
    started_at,
    expires_at,
    is_trial,
    is_unlimited,
    granted_by_admin_id
  ) VALUES (
    p_user_id,
    unlimited_plan_id,
    'active',
    NOW(),
    NOW() + INTERVAL '100 years',  -- Практически навсегда
    false,
    true,
    p_admin_id
  )
  RETURNING id INTO new_subscription_id;
  
  RAISE NOTICE 'Unlimited subscription granted to user % by admin %', p_user_id, p_admin_id;
  
  RETURN new_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- Функция для создания платной подписки
CREATE OR REPLACE FUNCTION create_paid_subscription(
  p_user_id BIGINT,
  p_plan_name TEXT,  -- 'monthly', 'quarterly', 'yearly'
  p_payment_id TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  plan_record RECORD;
  new_subscription_id BIGINT;
BEGIN
  -- Получаем план
  SELECT * INTO plan_record
  FROM subscription_plans 
  WHERE name = p_plan_name 
  LIMIT 1;
  
  IF plan_record IS NULL THEN
    RAISE EXCEPTION 'Plan % not found', p_plan_name;
  END IF;
  
  -- Деактивируем trial если есть
  UPDATE user_subscriptions
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status = 'trial';
  
  -- Создаем новую подписку
  INSERT INTO user_subscriptions (
    user_id,
    plan_id,
    status,
    started_at,
    expires_at,
    is_trial,
    payment_id
  ) VALUES (
    p_user_id,
    plan_record.id,
    'active',
    NOW(),
    NOW() + (plan_record.duration_days || ' days')::INTERVAL,
    false,
    p_payment_id
  )
  RETURNING id INTO new_subscription_id;
  
  RETURN new_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- Расширенная функция проверки подписки
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
        CASE 
            WHEN us.status IN ('trial', 'active') AND us.expires_at > NOW() THEN true
            ELSE false
        END as has_active_subscription,
        us.status,
        us.expires_at,
        us.is_trial,
        COALESCE(us.is_unlimited, false) as is_unlimited,
        EXTRACT(DAY FROM (us.expires_at - NOW()))::INTEGER as days_remaining,
        sp.name as plan_name,
        CASE 
            WHEN us.status = 'expired' OR (us.status = 'trial' AND us.expires_at < NOW()) THEN true
            ELSE false
        END as needs_payment
    FROM user_subscriptions us
    LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = p_user_id
    ORDER BY us.expires_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Функция для получения информации о подписке (для отображения в боте)
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
        -- Нет активной подписки - нужен платеж
        RETURN QUERY SELECT 
            '🔒'::TEXT,
            'Подписка истекла'::TEXT,
            'Требуется оплата'::TEXT,
            'Выбери план подписки'::TEXT,
            'buy_subscription'::TEXT;
    ELSIF sub.is_unlimited THEN
        -- Unlimited подписка
        RETURN QUERY SELECT 
            '👑'::TEXT,
            'Безлимитная подписка'::TEXT,
            '♾️ Навсегда'::TEXT,
            'Подарок от администрации'::TEXT,
            NULL::TEXT;
    ELSIF sub.is_trial THEN
        -- Trial период
        RETURN QUERY SELECT 
            '🎁'::TEXT,
            'Пробный период'::TEXT,
            FORMAT('%s дней осталось', sub.days_remaining)::TEXT,
            'Полный доступ бесплатно'::TEXT,
            CASE WHEN sub.days_remaining <= 2 THEN 'trial_ending' ELSE NULL END::TEXT;
    ELSE
        -- Платная подписка
        RETURN QUERY SELECT 
            '✅'::TEXT,
            'Активная подписка'::TEXT,
            FORMAT('%s дней осталось', sub.days_remaining)::TEXT,
            (SELECT features->>'name' FROM subscription_plans WHERE name = sub.plan_name)::TEXT,
            CASE WHEN sub.days_remaining <= 3 THEN 'renew_soon' ELSE NULL END::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- VIEW ДЛЯ АДМИН-ПАНЕЛИ
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
LEFT JOIN user_subscriptions us ON us.user_id = u.id 
  AND us.status IN ('trial', 'active')
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
ORDER BY us.expires_at ASC NULLS LAST;

-- ========================================
-- ПРОВЕРКА И СТАТИСТИКА
-- ========================================

-- Посмотреть все подписки
SELECT * FROM subscription_analytics;

-- Найти пользователей с истекшим trial
SELECT 
    u.telegram_id,
    u.username,
    us.expires_at,
    EXTRACT(DAY FROM (NOW() - us.expires_at)) as days_since_expired
FROM user_subscriptions us
JOIN users u ON u.id = us.user_id
WHERE us.status = 'trial' 
  AND us.expires_at < NOW()
ORDER BY us.expires_at DESC;

-- Статистика по подпискам
SELECT 
    COALESCE(sp.name, 'no_subscription') as plan,
    COUNT(*) as user_count,
    SUM(CASE WHEN us.status = 'active' THEN 1 ELSE 0 END) as active_count,
    SUM(CASE WHEN us.is_trial THEN 1 ELSE 0 END) as trial_count,
    SUM(CASE WHEN us.is_unlimited THEN 1 ELSE 0 END) as unlimited_count
FROM users u
LEFT JOIN user_subscriptions us ON us.user_id = u.id 
  AND us.status IN ('trial', 'active')
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
GROUP BY sp.name;

COMMENT ON FUNCTION grant_unlimited_subscription IS 'Выдает unlimited подписку пользователю (только для админа)';
COMMENT ON FUNCTION create_paid_subscription IS 'Создает платную подписку после успешной оплаты';
COMMENT ON FUNCTION get_subscription_info IS 'Возвращает информацию о подписке для отображения в боте';
COMMENT ON VIEW subscription_analytics IS 'Аналитика по подпискам для админ-панели';

