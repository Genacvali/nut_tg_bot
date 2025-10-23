# 🤖 C.I.D. Bot - Care • Insight • Discipline

AI-ассистент для управления питанием и КБЖУ в Telegram, работающий на Supabase Edge Functions.

## 🎯 Возможности

- ✅ **Онбординг**: Сбор данных пользователя (имя, пол, возраст, вес, рост, активность, цель, пожелания)
- 📊 **Расчет КБЖУ**: Автоматический расчет калорий, белков, жиров, углеводов и воды с помощью AI
- 🍽️ **Запись питания**: Текстовый и голосовой ввод приемов пищи с детализацией по продуктам
- 📋 **Меню рецептов**: AI-рекомендации блюд с учетом остатка КБЖУ и времени последнего приема
- 📊 **Дневник**: Отслеживание прогресса за день с визуализацией съеденного и оставшегося
- ✏️ **Редактирование**: Изменение параметров профиля и КБЖУ с автоматическим пересчетом калорий
- 🔄 **Корректировка**: Гибкая настройка плана питания с помощью AI
- 🎤 **Голосовой ввод**: Поддержка голосовых сообщений везде, где можно писать текст

## 🏗️ Архитектура

Проект полностью работает на **Supabase**:
- **Edge Functions** (Deno/TypeScript) - обработка Telegram webhook
- **PostgreSQL** - хранение данных пользователей, планов питания, записей еды
- **Secrets** - безопасное хранение API ключей

## 📁 Структура проекта

```
nut_tg_bot/
├── README.md                              # Документация
├── MIGRATION_FIX.sql                      # SQL миграция для БД
└── supabase/
    ├── database_schema.sql                # Схема базы данных
    ├── MIGRATION_FIX.sql                  # Дубликат миграции
    └── functions/
        ├── telegram-bot/
        │   └── index.ts                   # Основная логика бота (1605 строк)
        ├── set-webhook/
        │   └── index.ts                   # Установка Telegram webhook
        └── _shared/
            ├── openai.ts                  # Интеграция с OpenAI API
            └── calculators.ts             # Калькуляторы КБЖУ
```

## 🚀 Деплой через Supabase Dashboard

### 1. Создайте базу данных

В Supabase Dashboard → SQL Editor выполните:

1. `supabase/database_schema.sql` - создание таблиц
2. `MIGRATION_FIX.sql` - обновление схемы

### 2. Настройте секреты

В Supabase Dashboard → Project Settings → Edge Functions → Secrets:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key
```

### 3. Деплой Edge Functions

#### Через Dashboard:

1. Перейдите в **Edge Functions**
2. Создайте функцию `telegram-bot`
3. Скопируйте содержимое `supabase/functions/telegram-bot/index.ts`
4. Deploy

#### Через CLI (опционально):

```bash
# Установите Supabase CLI
npm install -g supabase

# Войдите в аккаунт
supabase login

# Свяжите проект
supabase link --project-ref your-project-ref

# Деплой функций
supabase functions deploy telegram-bot
supabase functions deploy set-webhook
```

### 4. Установите webhook

Вызовите функцию `set-webhook` через Dashboard или:

```bash
curl -X POST https://your-project-ref.supabase.co/functions/v1/set-webhook
```

## 🗄️ База данных

### Таблицы:

- `users` - пользователи Telegram
- `user_profiles` - профили (имя, возраст, вес, рост, активность, цель, пожелания)
- `nutrition_plans` - планы КБЖУ (калории, белки, жиры, углеводы, вода, рекомендации)
- `food_logs` - записи приемов пищи
- `user_states` - состояния FSM для диалогов

## 🤖 AI Модели

- **ChatGPT**: `gpt-4o-mini` - расчет КБЖУ, анализ питания, рекомендации
- **Whisper**: `whisper-1` - транскрипция голосовых сообщений

## 📝 Методология расчета КБЖУ

Бот использует формулу **Миффлина-Сан Жеора**:

```
BMR (мужчины) = 10 × вес(кг) + 6.25 × рост(см) - 5 × возраст + 5
BMR (женщины) = 10 × вес(кг) + 6.25 × рост(см) - 5 × возраст - 161

TDEE = BMR × коэффициент активности
- Низкая: 1.2
- Средняя: 1.55
- Высокая: 1.9

Целевая калорийность:
- Похудение: TDEE - 500 ккал
- Поддержание: TDEE
- Набор: TDEE + 300 ккал
```

## 🔧 Разработка

### Локальное тестирование (опционально):

```bash
# Запустите локальный Supabase
supabase start

# Запустите Edge Function локально
supabase functions serve telegram-bot --env-file .env
```

### Обновление кода:

1. Отредактируйте файлы в `supabase/functions/`
2. Деплой через Dashboard или CLI
3. Функция автоматически перезапустится

## 📊 Мониторинг

В Supabase Dashboard → Edge Functions → Logs:
- Просмотр логов в реальном времени
- Отладка ошибок
- Мониторинг производительности

## 🔐 Безопасность

- API ключи хранятся в Supabase Secrets
- База данных защищена Row Level Security (RLS)
- Edge Functions работают в изолированной среде Deno

## 📄 Лицензия

MIT

## 🤝 Поддержка

При возникновении проблем:
1. Проверьте логи в Supabase Dashboard
2. Убедитесь, что секреты установлены корректно
3. Проверьте, что webhook установлен правильно

---

**Версия**: 1.0  
**Последнее обновление**: 2025-10-23
