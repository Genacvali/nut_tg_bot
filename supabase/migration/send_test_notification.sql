-- ========================================
-- ОТПРАВКА ТЕСТОВОГО УВЕДОМЛЕНИЯ
-- Самый простой способ проверить систему!
-- ========================================

-- Этот скрипт отправит тестовое уведомление первому пользователю с включенными уведомлениями

DO $$
DECLARE
  test_user RECORD;
  test_plan RECORD;
  telegram_bot_token TEXT := 'YOUR_TELEGRAM_BOT_TOKEN'; -- ← Замените на ваш токен
  message_text TEXT;
  telegram_response TEXT;
BEGIN
  -- Находим первого пользователя с включенными уведомлениями
  SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    ns.food_notifications_enabled,
    ns.water_notifications_enabled
  INTO test_user
  FROM users u
  JOIN notification_settings ns ON ns.user_id = u.id
  WHERE ns.food_notifications_enabled = true 
     OR ns.water_notifications_enabled = true
  LIMIT 1;
  
  IF test_user.id IS NULL THEN
    RAISE NOTICE '❌ Нет пользователей с включенными уведомлениями';
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Найден пользователь: % (telegram_id: %)', test_user.first_name, test_user.telegram_id;
  
  -- Получаем план питания
  SELECT * INTO test_plan
  FROM nutrition_plans
  WHERE user_id = test_user.id AND is_active = true
  LIMIT 1;
  
  -- Формируем тестовое сообщение
  IF test_plan.id IS NOT NULL THEN
    message_text := format(
      E'🧪 **ТЕСТОВОЕ УВЕДОМЛЕНИЕ**\n\n' ||
      E'✅ Система уведомлений работает!\n\n' ||
      E'📊 Ваш план:\n' ||
      E'🔥 %s ккал\n' ||
      E'🥩 Белки: %sг\n' ||
      E'🥑 Жиры: %sг\n' ||
      E'🍞 Углеводы: %sг',
      test_plan.calories,
      test_plan.protein,
      test_plan.fats,
      test_plan.carbs
    );
  ELSE
    message_text := E'🧪 **ТЕСТОВОЕ УВЕДОМЛЕНИЕ**\n\n✅ Система уведомлений работает!';
  END IF;
  
  -- Отправляем через Telegram API
  SELECT content::TEXT INTO telegram_response
  FROM http((
    'POST',
    'https://api.telegram.org/bot' || telegram_bot_token || '/sendMessage',
    ARRAY[http_header('Content-Type', 'application/json')],
    'application/json',
    json_build_object(
      'chat_id', test_user.telegram_id,
      'text', message_text,
      'parse_mode', 'Markdown',
      'reply_markup', json_build_object(
        'inline_keyboard', json_build_array(
          json_build_array(
            json_build_object('text', '🍽 Записать прием', 'callback_data', 'log_food')
          )
        )
      )
    )::TEXT
  )::http_request);
  
  RAISE NOTICE '📤 Тестовое уведомление отправлено!';
  RAISE NOTICE '📱 Проверьте Telegram: @%', test_user.first_name;
  
  -- Логируем отправку
  INSERT INTO notification_logs (user_id, notification_type, sent_at)
  VALUES (test_user.id, 'test', NOW());
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Ошибка: %', SQLERRM;
END $$;

