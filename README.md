# 📁 Структура проекта nut_tg_bot

## 🗂️ Директории:

### 📚 `docs/` - Документация
- `README.md` - Основная документация проекта
- `DEPLOY_APPLE_WATCH.md` - Инструкция по интеграции Apple Watch
- `SMART_AI_UPDATE.md` - Обновления AI функций
- `TELEGRAM_FORMAT_FIX.md` - Исправления форматирования

### 🗄️ `migrations/` - SQL миграции
- `create_health_data_table.sql` - Таблица для данных Apple Watch
- `add_percentages_to_meals.sql` - Добавление полей процентов БЖУ
- `add_editing_meal_id.sql` - Поле для редактирования блюд
- `update_users_table.sql` - Обновление таблицы пользователей

### 📜 `sql/` - SQL скрипты
- Временные SQL файлы и запросы

### 🚀 `supabase/` - Supabase конфигурация
- `functions/` - Edge Functions (Deno/TypeScript)
- `migrations/` - Supabase миграции
- `config.toml` - Конфигурация проекта

### 🛠️ `scripts/` - Скрипты развертывания
- Скрипты для автоматизации деплоя

---

## 🎯 Основные компоненты:

### 🤖 Telegram Bot (Supabase Edge Functions)
- **`telegram-webhook`** - Основной обработчик бота
- **`daily-reports`** - Ежедневные отчеты
- **`meal-reminders`** - Напоминания о еде
- **`photo-analysis`** - Анализ фото еды
- **`export-data`** - Экспорт данных

### 🗄️ База данных (Supabase)
- **`users`** - Пользователи и их параметры
- **`meals`** - Приемы пищи с КБЖУ
- **`health_data`** - Данные Apple Watch
- **`checkins`** - Проверки веса и самочувствия

### 🔧 Интеграции
- **OpenAI GPT-4o** - Анализ еды и советы
- **OpenAI Whisper** - Транскрипция голоса
- **Apple Health** - Данные активности
- **Telegram Bot API** - Интерфейс бота

---

## 🚀 Быстрый старт:

1. **Настройка Supabase:**
   ```bash
   cd supabase
   # Выполните миграции из migrations/
   ```

2. **Деплой Edge Functions:**
   ```bash
   # Скопируйте код из supabase/functions/
   # В Supabase Dashboard → Edge Functions
   ```

3. **Настройка Telegram:**
   ```bash
   # Установите webhook на ваш Edge Function
   ```

---

## 📖 Документация:
Смотрите файлы в директории `docs/` для подробных инструкций.
