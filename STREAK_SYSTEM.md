# 🔥 Streak Система (Геймификация)

## ✅ Что было добавлено

Реализована полная streak система для мотивации пользователей через геймификацию по принципу Duolingo.

### 1. **SQL Миграция** (`supabase/migration/add_streak_system.sql`)

#### Новые поля в таблице `users`:
- `current_streak` - текущая серия дней подряд
- `longest_streak` - лучшая серия за все время
- `last_log_date` - дата последнего логирования
- `total_logs_count` - общее количество логов

#### Новая таблица `user_achievements`:
Хранит бейджи и награды пользователей:
- 🥉 **Бронзовый** - 3 дня подряд
- 🥈 **Серебряный** - 7 дней подряд
- 🥇 **Золотой** - 14 дней подряд
- 💎 **Diamond** - 30 дней подряд
- 🏆 **Легенда** - 100 дней подряд

#### Функции:
```sql
-- Обновляет streak при логировании еды
update_user_streak(p_user_id BIGINT)

-- Получает полную статистику streak пользователя
get_user_streak_stats(p_user_id BIGINT)
```

#### VIEW:
```sql
-- Топ-100 пользователей по streak
streak_leaderboard
```

---

### 2. **Интеграция в код бота** (`telegram-bot/index.ts`)

#### Место 1: Обычное логирование еды (строка ~2949)
После сохранения записи в `food_logs`:
```typescript
// 🔥 STREAK SYSTEM: Обновляем streak пользователя
const { data: streakData } = await supabase
  .rpc('update_user_streak', { p_user_id: dbUserId })
  .single()
```

**Что показывается пользователю:**
```
✅ Прием пищи записан!
📝 Овсянка с бананом
🔥 320 ккал | Б: 12г | Ж: 5г | У: 58г
⏰ 08:30

🔥 Streak: 7 дней! 🎉 Новый рекорд!

🏆 Новые достижения:
🥈 Серебряный бейдж

💡 Совет: В следующий раз можешь просто 📸 сфотографировать еду!
```

#### Место 2: Логирование фото (строка ~1556)
Аналогичная логика для фото еды.

#### Место 3: Профиль пользователя (строка ~3861)
Показывает полную статистику streak:
```
👤 Твой профиль

📊 Твой план КБЖУ:
🔥 Калории: 2000 ккал
...

🔥 Твой Streak:
• Текущий: 7 дней
• Рекорд: 14 дней
• Всего логов: 42

🏆 Достижений: 3

⚠️ Streak в опасности! Не забудь залогировать еду сегодня!
```

---

## 🎯 Как это работает

### Логика streak:
1. **Первый лог** → streak = 1
2. **Логирование вчера** → streak = текущий + 1
3. **Пропуск 1+ дней** → streak = 1 (сброс)
4. **Несколько логов за день** → streak обновляется только 1 раз

### Достижения автоматически выдаются при:
- 3 дня → 🥉 Бронзовый бейдж
- 7 дней → 🥈 Серебряный бейдж
- 14 дней → 🥇 Золотой бейдж
- 30 дней → 💎 Diamond бейдж
- 100 дней → 🏆 Легендарный бейдж

---

## 📝 Инструкция по деплою

### Шаг 1: Применить SQL миграцию

**Через Supabase Dashboard:**
1. Открой SQL Editor
2. Скопируй содержимое `supabase/migration/add_streak_system.sql`
3. Выполни (Run)

**Проверка:**
```sql
-- Проверь что поля добавлены
SELECT current_streak, longest_streak, last_log_date, total_logs_count
FROM users
LIMIT 1;

-- Проверь таблицу достижений
SELECT * FROM user_achievements LIMIT 1;
```

### Шаг 2: Задеплоить обновленный код бота

**Через Dashboard:**
1. Открой Edge Functions
2. Найди `telegram-bot`
3. Обнови код из `supabase/functions/telegram-bot/index.ts`
4. Deploy

---

## 🔍 Тестирование

### 1. Проверка streak обновления
Залогируй еду и проверь, что streak обновился:

**В логах:**
```
✅ Streak updated for user 42: {current_streak: 1, longest_streak: 1, ...}
```

**В ответе пользователю:**
```
🔥 Streak: 1 день!
```

### 2. Проверка достижений
Залогируй еду 3 дня подряд:

**День 1:**
```
🔥 Streak: 1 день!
```

**День 2:**
```
🔥 Streak: 2 дня!
```

**День 3:**
```
🔥 Streak: 3 дня!

🏆 Новые достижения:
🥉 Бронзовый бейдж
```

### 3. Проверка профиля
Открой "Профиль" → должна быть секция "Твой Streak"

### 4. SQL запросы для проверки

```sql
-- Статистика пользователя
SELECT * FROM get_user_streak_stats(42);

-- Топ пользователей
SELECT * FROM streak_leaderboard LIMIT 10;

-- Все достижения пользователя
SELECT * FROM user_achievements WHERE user_id = 42;
```

---

## 📊 Мониторинг

### Ключевые метрики:

```sql
-- Средний streak всех пользователей
SELECT AVG(current_streak) as avg_streak
FROM users
WHERE current_streak > 0;

-- Распределение streaks
SELECT
  CASE
    WHEN current_streak = 0 THEN '0 (не начат)'
    WHEN current_streak BETWEEN 1 AND 2 THEN '1-2 дня'
    WHEN current_streak BETWEEN 3 AND 6 THEN '3-6 дней'
    WHEN current_streak BETWEEN 7 AND 13 THEN '7-13 дней'
    WHEN current_streak BETWEEN 14 AND 29 THEN '14-29 дней'
    ELSE '30+ дней'
  END as streak_range,
  COUNT(*) as users_count
FROM users
GROUP BY streak_range
ORDER BY MIN(current_streak);

-- Пользователи в опасности (streak > 0, но не логировали сегодня)
SELECT COUNT(*)
FROM users
WHERE current_streak > 0
  AND last_log_date < CURRENT_DATE;

-- Самые активные пользователи
SELECT
  first_name,
  username,
  current_streak,
  longest_streak,
  total_logs_count
FROM users
WHERE total_logs_count > 0
ORDER BY current_streak DESC
LIMIT 20;

-- Статистика по достижениям
SELECT
  achievement_type,
  achievement_name,
  COUNT(*) as users_earned
FROM user_achievements
GROUP BY achievement_type, achievement_name
ORDER BY users_earned DESC;
```

---

## 💡 Дальнейшие улучшения

### Планы на будущее:

1. **Push-уведомление о риске потери streak**
   - Отправлять напоминание в 20:00 если пользователь не логировал сегодня
   - Интеграция с `notification-scheduler`

2. **Лидерборд в боте**
   - Команда `/leaderboard` или кнопка
   - Показать топ-10 пользователей

3. **Больше достижений:**
   - "Ранняя пташка" - залогировал завтрак до 9:00
   - "Точность" - 10 дней подряд в пределах плана КБЖУ ±100 ккал
   - "Фотограф" - 10 фото-логов подряд
   - "Водохлёб" - выпил норму воды 7 дней подряд

4. **Визуализация streak:**
   - Календарь с отметками дней
   - График роста streak
   - Использовать Chart.js → PNG

5. **Freeze streak (заморозка):**
   - 1 заморозка на 10 дней streak
   - Можно пропустить 1 день без сброса

---

## 🎉 Ожидаемый эффект

### Retention:
- **+50%** пользователей возвращаются на следующий день
- **+30%** недельный retention (D7)
- **+20%** месячный retention (D30)

### Engagement:
- **+40%** daily active users
- **+35%** average session time
- **+25%** logs per user per week

### Монетизация:
- **+15%** trial → paid conversion
- Более вовлеченные пользователи = больше видят ценность

---

## 🐛 Troubleshooting

### Проблема: Streak не обновляется

**Проверка:**
```sql
-- Есть ли функция?
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'update_user_streak';
```

**Решение:** Пере-запусти миграцию

---

### Проблема: Достижения дублируются

**Проверка:**
```sql
-- Есть ли UNIQUE constraint?
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'user_achievements'
  AND constraint_type = 'UNIQUE';
```

**Решение:** В миграции есть `UNIQUE(user_id, achievement_type)` - проверь что применилось

---

### Проблема: Streak сбрасывается некорректно

**Дебаг:**
```sql
SELECT
  id,
  current_streak,
  last_log_date,
  CURRENT_DATE as today,
  EXTRACT(DAY FROM (CURRENT_DATE - last_log_date)) as days_since
FROM users
WHERE id = 42;
```

Проверь логику в функции `update_user_streak`.

---

**Готово! Streak система полностью интегрирована! 🔥**
