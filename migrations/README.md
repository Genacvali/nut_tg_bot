# 🗄️ SQL Миграции

## 📄 Файлы миграций:

### 🏗️ Создание таблиц:
- **`create_health_data_table.sql`** - Таблица для данных Apple Watch/Apple Health
  - Поля: weight, steps, sleep_hours, active_calories, water_ml, heart_rate_avg
  - Индексы и триггеры для автоматического обновления

### 🔄 Обновление существующих таблиц:
- **`add_percentages_to_meals.sql`** - Добавление полей процентов БЖУ в таблицу meals
  - Поля: protein_percent, carbs_percent, fat_percent, weight_grams
- **`add_editing_meal_id.sql`** - Добавление поля для редактирования блюд в таблицу users
  - Поле: editing_meal_id (для хранения ID редактируемого блюда)
- **`update_users_table.sql`** - Обновление таблицы пользователей
  - Поля: height, weight, goal, target_weight, activity, age

---

## 🚀 Как применять:

### В Supabase Dashboard:
1. Откройте **SQL Editor**
2. Скопируйте содержимое нужного файла
3. Выполните запрос
4. Проверьте результат в **Table Editor**

### Порядок применения:
1. `update_users_table.sql` (если таблица users уже существует)
2. `create_health_data_table.sql`
3. `add_percentages_to_meals.sql`
4. `add_editing_meal_id.sql`

---

## ⚠️ Важно:

- Все миграции используют `IF NOT EXISTS` для безопасности
- Проверяйте результат выполнения
- Делайте бэкап перед применением миграций
