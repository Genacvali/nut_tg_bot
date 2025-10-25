# 🤖 C.I.D. - AI Nutritionist Telegram Bot

Персональный AI-нутрициолог в Telegram, который помогает контролировать питание, считать калории и достигать целей в здоровом образе жизни.

## ✨ Возможности

- 🎯 **Персональные планы питания** - индивидуальные рекомендации на основе ваших целей
- 🍽️ **Умное логирование еды** - просто говорите голосом что съели, бот всё посчитает
- 📊 **Детальная статистика** - отслеживание КБЖУ, воды и прогресса
- 🍳 **Рецепты и меню** - подбор блюд с учётом ваших предпочтений
- 💎 **Гибкая подписка** - пробный период + платные тарифы
- 🔒 **Безопасные платежи** - интеграция с T-Bank

## 🚀 Быстрый старт

### Предварительные требования

- Node.js 18+
- Supabase CLI
- Telegram Bot Token
- T-Bank терминал (для платежей)

### Установка

1. **Клонируйте репозиторий:**
```bash
git clone <repository-url>
cd nut_tg_bot
```

2. **Установите зависимости:**
```bash
npm install
```

3. **Настройте Supabase:**
```bash
supabase login
supabase link --project-ref your-project-ref
```

4. **Настройте переменные окружения:**
```bash
cp .env.example .env
# Отредактируйте .env файл с вашими данными
```

5. **Примените миграции базы данных:**
```bash
supabase db push
```

6. **Задеплойте функции:**
```bash
supabase functions deploy --no-verify-jwt
```

## 📁 Структура проекта

```
nut_tg_bot/
├── supabase/
│   ├── functions/
│   │   ├── telegram-bot/          # Основная логика бота
│   │   ├── tbank-payment/         # Создание платежей
│   │   ├── tbank-webhook/         # Обработка webhook'ов
│   │   ├── send-thank-you-messages/ # Отправка благодарственных сообщений
│   │   └── notification-scheduler/ # Планировщик уведомлений
│   └── migration/
│       ├── database_schema.sql    # Основная схема БД
│       ├── admin_subscription_management.sql # Админские функции
│       └── fix_foreign_keys_cascade.sql # Исправления FK
├── ADMIN_GUIDE.md                 # Руководство администратора
└── README.md                      # Этот файл
```

## ⚙️ Конфигурация

### Переменные окружения

```bash
# Supabase
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token

# T-Bank
TBANK_TERMINAL_KEY=your-terminal-key
TBANK_PASSWORD=your-password
```

### Настройка T-Bank

1. Получите терминал в T-Bank
2. Установите переменные `TBANK_TERMINAL_KEY` и `TBANK_PASSWORD`
3. Настройте webhook URL: `https://your-project.supabase.co/functions/v1/tbank-webhook`

## 🎯 Основные функции

### Telegram Bot (`telegram-bot/`)

- Обработка команд и сообщений
- Определение намерений пользователя (еда/рецепты/вопросы)
- Управление профилем и подписками
- Интеграция с OpenAI для анализа питания

### Платежи (`tbank-payment/` + `tbank-webhook/`)

- Создание платежных намерений
- Обработка webhook'ов от T-Bank
- Активация подписок после успешной оплаты
- Уведомления пользователей о статусе платежа

### Уведомления (`notification-scheduler/`)

- Планирование напоминаний о еде и воде
- Отправка персонализированных советов

## 📊 База данных

### Основные таблицы

- `users` - пользователи Telegram
- `user_profiles` - профили пользователей
- `user_subscriptions` - подписки
- `subscription_plans` - тарифные планы
- `payment_intents` - платежные намерения
- `food_logs` - записи о еде
- `nutrition_plans` - планы питания

### Админские функции

- `admin_subscriptions_view` - просмотр всех подписок
- `admin_extend_subscription()` - продление подписки
- `admin_grant_unlimited()` - выдача безлимитной подписки
- `admin_delete_user()` - безопасное удаление пользователя

## 🔧 Разработка

### Локальная разработка

```bash
# Запуск локального Supabase
supabase start

# Разработка функций
supabase functions serve

# Тестирование
supabase functions invoke telegram-bot --method POST
```

### Деплой

```bash
# Деплой всех функций
supabase functions deploy --no-verify-jwt

# Деплой конкретной функции
supabase functions deploy telegram-bot --no-verify-jwt
```

### Логи

```bash
# Просмотр логов
supabase functions logs telegram-bot
supabase functions logs tbank-webhook
```

## 📱 Использование бота

### Команды

- `/start` - регистрация и начало работы
- `/help` - помощь и информация о подписке

### Основные функции

1. **Заполнение профиля** - возраст, пол, цели, активность
2. **Логирование еды** - голосовые сообщения или текст
3. **Получение рекомендаций** - планы питания и рецепты
4. **Отслеживание прогресса** - статистика КБЖУ

### Подписки

- **Trial** - 7 дней бесплатно
- **Monthly** - 129₽/месяц
- **Quarterly** - 649₽/6 месяцев
- **Yearly** - 1099₽/год
- **Unlimited** - безлимитная (для ранних пользователей)

## 🛠️ Администрирование

Подробное руководство администратора смотрите в [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).

### Основные операции

```sql
-- Просмотр всех подписок
SELECT * FROM admin_subscriptions_view;

-- Продление подписки на 30 дней
SELECT admin_extend_subscription(user_id, 30);

-- Выдача безлимитной подписки
SELECT admin_grant_unlimited(telegram_id);

-- Безопасное удаление пользователя
SELECT admin_delete_user(user_id);
```

## 🐛 Отладка

### Частые проблемы

1. **Webhook не приходит** - проверьте NotificationURL в tbank-payment
2. **Дублирующиеся уведомления** - исправлено в tbank-webhook
3. **Ошибки OpenAI** - проверьте API ключ и лимиты
4. **Проблемы с подписками** - используйте админские функции

### Логирование

Все функции логируют важные события. Используйте Supabase Dashboard или CLI для просмотра логов.

## 📄 Лицензия

MIT License

## 🤝 Поддержка

Для вопросов и поддержки обращайтесь к администратору: @gena12m

---

**C.I.D. - ваш персональный AI-нутрициолог! 🚀**