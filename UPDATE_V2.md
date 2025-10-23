# 🚀 Обновление до версии 2.0 (C.I.D.)

## ✨ Что нового:

### Новый онбординг:
1. Приветствие C.I.D. (Care • Insight • Discipline)
2. Кнопка "Заполнить профиль"
3. Сбор: Имя → Пол → Возраст → Вес → Рост → Активность → Цель → Пожелания
4. LLM учитывает пожелания клиента
5. Карточка КБЖУ с водой и рекомендациями по активности
6. Три кнопки: Готово / Редактировать / Скорректировать

### Корректировка плана:
- Клиент может писать/говорить что изменить
- LLM пересчитывает план на лету
- Обновленная карточка с объяснениями

## 📋 Шаги для обновления:

### 1. Обновите базу данных

Откройте Supabase Dashboard → SQL Editor и выполните:

```sql
-- Обновление таблицы user_profiles
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS name VARCHAR(255),
ADD COLUMN IF NOT EXISTS wishes TEXT,
ALTER COLUMN target_weight DROP NOT NULL;

-- Изменение проверки activity_level (сначала удаляем старую)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_activity_level_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_activity_level_check 
  CHECK (activity_level IN ('low', 'medium', 'high'));

-- Обновление таблицы nutrition_plans
ALTER TABLE nutrition_plans 
ADD COLUMN IF NOT EXISTS water DECIMAL(6,2),
ADD COLUMN IF NOT EXISTS activity_recommendations TEXT;
```

### 2. Обновите Edge Function

В Supabase Dashboard → Edge Functions → telegram-bot:

1. Удалите старый код
2. Скопируйте содержимое `supabase/functions/telegram-bot/index.ts`
3. Нажмите **Deploy**

### 3. Проверьте секреты

Dashboard → Settings → Edge Functions → Secrets:
- ✅ `TELEGRAM_BOT_TOKEN`
- ✅ `OPENAI_API_KEY`

### 4. Переустановите webhook

```bash
curl -X POST https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/set-webhook
```

### 5. Протестируйте

1. Найдите бота в Telegram
2. Отправьте `/start`
3. Вы должны увидеть новое приветствие C.I.D.
4. Нажмите "Заполнить профиль"
5. Пройдите весь процесс
6. Протестируйте корректировку плана

## 🔄 Миграция существующих пользователей:

Если у вас уже есть пользователи:

```sql
-- Установить значения по умолчанию для новых полей
UPDATE user_profiles 
SET name = first_name 
WHERE name IS NULL;

UPDATE user_profiles 
SET wishes = 'Без дополнительных пожеланий' 
WHERE wishes IS NULL;

-- Конвертировать старые уровни активности
UPDATE user_profiles 
SET activity_level = CASE 
  WHEN activity_level IN ('sedentary', 'light') THEN 'low'
  WHEN activity_level = 'moderate' THEN 'medium'
  WHEN activity_level IN ('active', 'very_active') THEN 'high'
  ELSE activity_level
END;

-- Установить воду по умолчанию (2 литра)
UPDATE nutrition_plans 
SET water = 2.0 
WHERE water IS NULL;
```

## 🐛 Откат (если что-то пошло не так):

### Откат базы данных:
```sql
ALTER TABLE user_profiles 
DROP COLUMN IF EXISTS name,
DROP COLUMN IF EXISTS wishes;

ALTER TABLE nutrition_plans 
DROP COLUMN IF EXISTS water,
DROP COLUMN IF EXISTS activity_recommendations;
```

### Откат Edge Function:
1. Восстановите старую версию из GitHub/backup
2. Или используйте версию из ветки `v1`

## 📊 Проверка обновления:

```sql
-- Проверить структуру таблиц
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_profiles' 
AND column_name IN ('name', 'wishes');

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'nutrition_plans' 
AND column_name IN ('water', 'activity_recommendations');
```

## ✅ Checklist обновления:

- [ ] Выполнен SQL для обновления БД
- [ ] Обновлена Edge Function
- [ ] Проверены секреты
- [ ] Переустановлен webhook
- [ ] Протестирован новый онбординг
- [ ] Протестирована корректировка плана
- [ ] Проверена работа с существующими пользователями

## 🎉 Готово!

Ваш бот C.I.D. обновлен до версии 2.0!

**Changelog:** См. `CHANGELOG.md` для полного списка изменений

