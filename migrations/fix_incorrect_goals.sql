-- Исправляем некорректные цели (слишком высокие значения)
-- Обновляем только те записи, где калории явно некорректны (больше 10000)

UPDATE users
SET 
  calories_goal = CASE 
    WHEN goal = 'lose' THEN 2500
    WHEN goal = 'gain' THEN 3500
    ELSE 3000
  END,
  protein_goal = CASE 
    WHEN goal = 'lose' THEN 200
    WHEN goal = 'gain' THEN 250
    ELSE 220
  END,
  carbs_goal = CASE 
    WHEN goal = 'lose' THEN 200
    WHEN goal = 'gain' THEN 350
    ELSE 300
  END,
  fat_goal = CASE 
    WHEN goal = 'lose' THEN 70
    WHEN goal = 'gain' THEN 90
    ELSE 80
  END
WHERE calories_goal > 10000 OR calories_goal IS NULL;

-- Комментарий
COMMENT ON TABLE users IS 'Пользователи бота с их параметрами и целями по питанию';

