-- ============================================
-- ОБНОВЛЕНИЕ ЦЕН НА ПОДПИСКУ
-- ============================================
-- Новые цены:
-- 1 месяц: 129₽
-- 6 месяцев: 649₽
-- 1 год: 1099₽
-- ============================================

-- Обновляем цены для существующих планов
UPDATE subscription_plans 
SET 
  price_usd = 1.36,  -- 129₽ / 95 курс (для справки)
  price_rub = 129.00,
  updated_at = NOW()
WHERE name = 'monthly';

-- Обновляем план на 3 месяца -> 6 месяцев
UPDATE subscription_plans 
SET 
  name = 'quarterly',
  duration_days = 180,  -- 6 месяцев
  price_usd = 6.83,  -- 649₽ / 95 курс
  price_rub = 649.00,
  updated_at = NOW()
WHERE name = 'quarterly';

UPDATE subscription_plans 
SET 
  price_usd = 11.57,  -- 1099₽ / 95 курс
  price_rub = 1099.00,
  updated_at = NOW()
WHERE name = 'yearly';

-- Проверяем результат
SELECT 
  id,
  name,
  duration_days,
  price_rub,
  is_active,
  updated_at
FROM subscription_plans
ORDER BY duration_days;