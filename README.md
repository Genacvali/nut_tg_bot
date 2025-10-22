# 🍎 Telegram Bot - Нутрициолог-Ассистент

Бот для отслеживания питания и КБЖУ с использованием Supabase Edge Functions.

## 🚀 Быстрый старт

### 1. Установите Supabase CLI
```bash
npm install -g supabase
```

### 2. Логин в Supabase
```bash
supabase login
```

### 3. Линкуйте проект
```bash
cd /home/gena1/nut_tg_bot
supabase link --project-ref itlqgwevcuoysdmuttwy
```

### 4. Добавьте секреты
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=ваш_токен
supabase secrets set OPENAI_API_KEY=ваш_ключ
supabase secrets set SUPABASE_URL=https://itlqgwevcuoysdmuttwy.supabase.co
supabase secrets set SUPABASE_ANON_KEY=ваш_ключ
```

### 5. Деплой функций
```bash
supabase functions deploy telegram-webhook
supabase functions deploy daily-reports
supabase functions deploy photo-analysis
supabase functions deploy export-data
```

### 6. Настройте webhook
```bash
curl -X POST "https://api.telegram.org/botВАШ_ТОКЕН/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook"}'
```

## 📁 Структура проекта

```
nut_tg_bot/
├── supabase/
│   ├── functions/
│   │   ├── telegram-webhook/      # Основной webhook
│   │   ├── daily-reports/         # Ежедневные отчеты
│   │   ├── photo-analysis/        # Анализ фото
│   │   └── export-data/           # Экспорт данных
│   ├── migrations/                # SQL миграции
│   └── config.toml                # Конфигурация проекта
└── .gitignore
```

## ⚙️ Edge Functions

### telegram-webhook
Основная функция для обработки сообщений от Telegram.
- Обрабатывает команды (/start, /help, /stats, /goals)
- Анализирует текст через OpenAI
- Анализирует фото через GPT-4 Vision
- Сохраняет данные в Supabase

### daily-reports
Отправляет ежедневные отчеты всем пользователям.
- Запускается по расписанию (через pg_cron)
- Анализирует КБЖУ за день
- Дает советы по питанию

### photo-analysis
Анализирует фото еды.
- Использует GPT-4 Vision
- Определяет КБЖУ по изображению

### export-data
Экспортирует данные пользователя в CSV.
- Экспорт за последние N дней
- Формат CSV для анализа

## 📊 Команды бота

- `/start` - Начать работу
- `/help` - Справка
- `/stats` - Статистика за сегодня
- `/goals` - Настройка целей
- Текст - анализ еды
- Фото - анализ фото еды

## 🔧 Разработка

### Локальная разработка
```bash
supabase functions serve telegram-webhook
```

### Деплой всех функций
```bash
supabase functions deploy
```

### Просмотр логов
```bash
supabase functions logs telegram-webhook
```

## 📝 Настройка базы данных

Выполните SQL из `supabase/migrations/20241022000000_setup_tables.sql` в Supabase Dashboard → SQL Editor.

## 🔐 Секреты

Все секреты хранятся в Supabase Edge Functions Secrets:
- `TELEGRAM_BOT_TOKEN` - токен бота
- `OPENAI_API_KEY` - ключ OpenAI
- `SUPABASE_URL` - URL проекта
- `SUPABASE_ANON_KEY` - ключ Supabase