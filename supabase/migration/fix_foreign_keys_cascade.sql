-- ============================================
-- FIX FOREIGN KEYS WITH CASCADE DELETE
-- ============================================
-- Эта миграция добавляет CASCADE DELETE для всех связанных таблиц
-- чтобы при удалении пользователя автоматически удалялись все его данные
-- ============================================

-- 1. payment_intents: при удалении пользователя - удаляем его платежи
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_intents') THEN
    ALTER TABLE payment_intents
    DROP CONSTRAINT IF EXISTS payment_intents_user_id_fkey,
    ADD CONSTRAINT payment_intents_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated payment_intents foreign key';
  END IF;
END $$;

-- 2. user_subscriptions: при удалении пользователя - удаляем его подписки
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_subscriptions') THEN
    -- Foreign key для user_id (основной пользователь)
    ALTER TABLE user_subscriptions
    DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_fkey,
    ADD CONSTRAINT user_subscriptions_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    
    -- Foreign key для granted_by_admin_id (администратор который выдал подписку)
    -- Используем SET NULL вместо CASCADE, чтобы при удалении админа подписки остались
    ALTER TABLE user_subscriptions
    DROP CONSTRAINT IF EXISTS user_subscriptions_granted_by_admin_id_fkey,
    ADD CONSTRAINT user_subscriptions_granted_by_admin_id_fkey 
      FOREIGN KEY (granted_by_admin_id) 
      REFERENCES users(id) 
      ON DELETE SET NULL;
    
    RAISE NOTICE 'Updated user_subscriptions foreign keys (user_id + granted_by_admin_id)';
  END IF;
END $$;

-- 3. user_profiles: при удалении пользователя - удаляем его профиль
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
    ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_user_id_fkey,
    ADD CONSTRAINT user_profiles_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated user_profiles foreign key';
  END IF;
END $$;

-- 4. nutrition_plans: при удалении пользователя - удаляем его планы питания
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nutrition_plans') THEN
    ALTER TABLE nutrition_plans
    DROP CONSTRAINT IF EXISTS nutrition_plans_user_id_fkey,
    ADD CONSTRAINT nutrition_plans_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated nutrition_plans foreign key';
  END IF;
END $$;

-- 5. food_logs: при удалении пользователя - удаляем его записи еды
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'food_logs') THEN
    ALTER TABLE food_logs
    DROP CONSTRAINT IF EXISTS food_logs_user_id_fkey,
    ADD CONSTRAINT food_logs_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated food_logs foreign key';
  END IF;
END $$;

-- 6. water_logs: при удалении пользователя - удаляем его записи воды (если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'water_logs') THEN
    ALTER TABLE water_logs
    DROP CONSTRAINT IF EXISTS water_logs_user_id_fkey,
    ADD CONSTRAINT water_logs_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated water_logs foreign key';
  END IF;
END $$;

-- 7. notification_settings: при удалении пользователя - удаляем его настройки уведомлений
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_settings') THEN
    ALTER TABLE notification_settings
    DROP CONSTRAINT IF EXISTS notification_settings_user_id_fkey,
    ADD CONSTRAINT notification_settings_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated notification_settings foreign key';
  END IF;
END $$;

-- 8. user_states: при удалении пользователя - удаляем его состояния
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_states') THEN
    ALTER TABLE user_states
    DROP CONSTRAINT IF EXISTS user_states_telegram_id_fkey,
    ADD CONSTRAINT user_states_telegram_id_fkey 
      FOREIGN KEY (telegram_id) 
      REFERENCES users(telegram_id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated user_states foreign key';
  END IF;
END $$;

-- 9. notification_logs: при удалении пользователя - удаляем логи уведомлений
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_logs') THEN
    ALTER TABLE notification_logs
    DROP CONSTRAINT IF EXISTS notification_logs_user_id_fkey,
    ADD CONSTRAINT notification_logs_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated notification_logs foreign key';
  END IF;
END $$;

-- 10. llm_usage_logs: при удалении пользователя - удаляем логи использования LLM
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'llm_usage_logs') THEN
    ALTER TABLE llm_usage_logs
    DROP CONSTRAINT IF EXISTS llm_usage_logs_user_id_fkey,
    ADD CONSTRAINT llm_usage_logs_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated llm_usage_logs foreign key';
  END IF;
END $$;

-- 11. usage_logs: при удалении пользователя - удаляем логи использования
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs') THEN
    ALTER TABLE usage_logs
    DROP CONSTRAINT IF EXISTS usage_logs_user_id_fkey,
    ADD CONSTRAINT usage_logs_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated usage_logs foreign key';
  END IF;
END $$;

-- 12. payments: при удалении пользователя - удаляем платежи
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
    ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_user_id_fkey,
    ADD CONSTRAINT payments_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated payments foreign key';
  END IF;
END $$;

-- 13. meal_plans: при удалении пользователя - удаляем планы питания
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meal_plans') THEN
    ALTER TABLE meal_plans
    DROP CONSTRAINT IF EXISTS meal_plans_user_id_fkey,
    ADD CONSTRAINT meal_plans_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated meal_plans foreign key';
  END IF;
END $$;

-- 14. food_logs_archive: при удалении пользователя - удаляем архивные записи еды
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'food_logs_archive') THEN
    ALTER TABLE food_logs_archive
    DROP CONSTRAINT IF EXISTS food_logs_archive_user_id_fkey,
    ADD CONSTRAINT food_logs_archive_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES users(id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Updated food_logs_archive foreign key';
  END IF;
END $$;

-- Также можно добавить индексы для ускорения операций удаления (если их нет)
DO $$
BEGIN
  -- Создаём индексы только для существующих таблиц
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_intents') THEN
    CREATE INDEX IF NOT EXISTS idx_payment_intents_user_id ON payment_intents(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_subscriptions') THEN
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
    CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nutrition_plans') THEN
    CREATE INDEX IF NOT EXISTS idx_nutrition_plans_user_id ON nutrition_plans(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'food_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_food_logs_user_id ON food_logs(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'water_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_water_logs_user_id ON water_logs(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_settings') THEN
    CREATE INDEX IF NOT EXISTS idx_notification_settings_user_id ON notification_settings(user_id);
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_states') THEN
    CREATE INDEX IF NOT EXISTS idx_user_states_telegram_id ON user_states(telegram_id);
  END IF;
  
  RAISE NOTICE 'Indexes created for existing tables';
END $$;

-- ============================================
-- ФУНКЦИЯ ДЛЯ БЕЗОПАСНОГО УДАЛЕНИЯ ПОЛЬЗОВАТЕЛЯ
-- ============================================

CREATE OR REPLACE FUNCTION admin_delete_user(p_user_id INTEGER)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_telegram_id BIGINT;
  v_payment_intents INTEGER := 0;
  v_subscriptions INTEGER := 0;
  v_food_logs INTEGER := 0;
  v_water_logs INTEGER := 0;
  v_nutrition_plans INTEGER := 0;
  v_profiles INTEGER := 0;
  v_notification_settings INTEGER := 0;
  v_notification_logs INTEGER := 0;
  v_states INTEGER := 0;
  v_llm_logs INTEGER := 0;
  v_usage_logs INTEGER := 0;
  v_payments INTEGER := 0;
  v_meal_plans INTEGER := 0;
  v_food_archive INTEGER := 0;
BEGIN
  -- Получаем telegram_id для логирования
  SELECT telegram_id INTO v_telegram_id
  FROM users
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  -- Собираем статистику перед удалением (используя динамический SQL для несуществующих таблиц)
  
  -- payment_intents
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_intents') THEN
    SELECT COUNT(*) INTO v_payment_intents FROM payment_intents WHERE user_id = p_user_id;
  END IF;
  
  -- user_subscriptions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_subscriptions') THEN
    SELECT COUNT(*) INTO v_subscriptions FROM user_subscriptions WHERE user_id = p_user_id;
  END IF;
  
  -- food_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'food_logs') THEN
    SELECT COUNT(*) INTO v_food_logs FROM food_logs WHERE user_id = p_user_id;
  END IF;
  
  -- water_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'water_logs') THEN
    SELECT COUNT(*) INTO v_water_logs FROM water_logs WHERE user_id = p_user_id;
  END IF;
  
  -- nutrition_plans
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nutrition_plans') THEN
    SELECT COUNT(*) INTO v_nutrition_plans FROM nutrition_plans WHERE user_id = p_user_id;
  END IF;
  
  -- user_profiles
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
    SELECT COUNT(*) INTO v_profiles FROM user_profiles WHERE user_id = p_user_id;
  END IF;
  
  -- notification_settings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_settings') THEN
    SELECT COUNT(*) INTO v_notification_settings FROM notification_settings WHERE user_id = p_user_id;
  END IF;
  
  -- notification_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_logs') THEN
    SELECT COUNT(*) INTO v_notification_logs FROM notification_logs WHERE user_id = p_user_id;
  END IF;
  
  -- user_states
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_states') THEN
    SELECT COUNT(*) INTO v_states FROM user_states WHERE telegram_id = v_telegram_id;
  END IF;
  
  -- llm_usage_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'llm_usage_logs') THEN
    SELECT COUNT(*) INTO v_llm_logs FROM llm_usage_logs WHERE user_id = p_user_id;
  END IF;
  
  -- usage_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs') THEN
    SELECT COUNT(*) INTO v_usage_logs FROM usage_logs WHERE user_id = p_user_id;
  END IF;
  
  -- payments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
    SELECT COUNT(*) INTO v_payments FROM payments WHERE user_id = p_user_id;
  END IF;
  
  -- meal_plans
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meal_plans') THEN
    SELECT COUNT(*) INTO v_meal_plans FROM meal_plans WHERE user_id = p_user_id;
  END IF;
  
  -- food_logs_archive
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'food_logs_archive') THEN
    SELECT COUNT(*) INTO v_food_archive FROM food_logs_archive WHERE user_id = p_user_id;
  END IF;
  
  -- Удаляем пользователя (все связанные записи удалятся автоматически благодаря CASCADE)
  DELETE FROM users WHERE id = p_user_id;
  
  -- Логируем удаление
  RAISE NOTICE 'User % (telegram_id: %) deleted with all related data', p_user_id, v_telegram_id;
  
  -- Возвращаем результат
  RETURN json_build_object(
    'success', true,
    'deleted_data', json_build_object(
      'user_id', p_user_id,
      'telegram_id', v_telegram_id,
      'deleted_records', json_build_object(
        'payment_intents', v_payment_intents,
        'user_subscriptions', v_subscriptions,
        'food_logs', v_food_logs,
        'water_logs', v_water_logs,
        'nutrition_plans', v_nutrition_plans,
        'user_profiles', v_profiles,
        'notification_settings', v_notification_settings,
        'notification_logs', v_notification_logs,
        'user_states', v_states,
        'llm_usage_logs', v_llm_logs,
        'usage_logs', v_usage_logs,
        'payments', v_payments,
        'meal_plans', v_meal_plans,
        'food_logs_archive', v_food_archive
      )
    )
  );
END;
$$;

-- Комментарий к функции
COMMENT ON FUNCTION admin_delete_user IS 'Безопасно удаляет пользователя и все связанные данные. Возвращает статистику удаленных записей.';

-- Лог
DO $$
BEGIN
  RAISE NOTICE 'Foreign keys updated with CASCADE DELETE';
  RAISE NOTICE 'Now you can safely delete users and all related data will be automatically deleted';
  RAISE NOTICE 'Use admin_delete_user(user_id) function for safe deletion with statistics';
END $$;

