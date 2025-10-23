# 🍎 AI Бот-нутрициолог - Рефакторинг v2.0

Персональный помощник по питанию с искусственным интеллектом для Telegram.

## 🚀 Новые возможности

### 📊 Расчётный движок
- **BMR/TDEE** по формуле Миффлина-Сан Жеора
- **Персональные макросы** с валидацией минимумов
- **Корректировки** по граммам и процентам
- **Автоматическое перераспределение** калорий

### 🎯 Telegram UX
- **Инлайн-меню** без команд
- **Потоки онбординга** с пошаговой настройкой
- **Навигация** через кнопки
- **Состояние пользователя** с памятью

### 🎤 Голосовой ввод
- **STT** через OpenAI Whisper
- **Анализ намерений** из речи
- **Поддержка** voice/video note
- **Эхо-подтверждение** распознанного текста

### ⏰ Система напоминаний
- **Планировщик** с cron job
- **Отчёты дня** с персональными советами
- **Напоминания** о приёмах пищи
- **Уведомления** о взвешивании

### 🧠 Память и контекст
- **Предпочтения** пользователя
- **История** приёмов пищи
- **Контекст** разговора
- **Персональные советы**

### 📈 Аналитика
- **Логирование событий** в БД
- **Метрики** использования
- **Дашборд** для мониторинга
- **Отслеживание** прогресса

## 🏗️ Архитектура

```
src/
├── calculation-engine.ts    # Расчёт BMR, TDEE, макросы
├── telegram-ux.ts          # Инлайн-меню и навигация
├── voice-input.ts          # STT и анализ намерений
├── reminders-system.ts     # Планировщик и отчёты
├── memory-context.ts       # Память и персонализация
├── message-templates.ts    # Шаблоны с тоном C.I.D.
└── analytics-logging.ts    # Аналитика и метрики

migrations/
├── refactor_users_table.sql
├── create_plans_table.sql
├── create_preferences_table.sql
├── create_daily_totals_table.sql
├── create_reminders_table.sql
├── create_state_table.sql
└── create_events_log_table.sql

supabase/functions/
├── telegram-webhook/       # Основной бот
└── reminder-cron/          # Планировщик
```

## 🗄️ Структура БД

### users (обновлена)
```sql
age SMALLINT,
sex TEXT CHECK (sex IN ('male','female')),
height_cm NUMERIC(5,1),
weight_kg NUMERIC(5,1),
activity TEXT CHECK (activity IN ('sedentary','light','moderate','high','very_high')),
goal TEXT CHECK (goal IN ('fat_loss','maintain','gain')),
tz TEXT DEFAULT 'Europe/Moscow',
language TEXT DEFAULT 'ru',
tone TEXT CHECK (tone IN ('coach','mentor','neutral')) DEFAULT 'mentor'
```

### plans (новая)
```sql
kcal INT,
p NUMERIC(5,1),  -- белки
f NUMERIC(5,1),  -- жиры
c NUMERIC(5,1),  -- углеводы
rules_json JSONB,
is_active BOOLEAN DEFAULT true,
source TEXT CHECK (source IN ('auto','manual')) DEFAULT 'auto'
```

### preferences (новая)
```sql
diet TEXT CHECK (diet IN ('default','hi_protein','low_carb','vegetarian','keto')),
dislikes TEXT,
allergies TEXT,
eat_window_start TIME,
eat_window_end TIME
```

### daily_totals (новая)
```sql
date DATE,
kcal INT,
p INT, f INT, c INT,
UNIQUE (user_id, date)
```

### reminders (новая)
```sql
kind TEXT CHECK (kind IN ('day_report','meal','weigh')),
time_local TIME,
is_enabled BOOLEAN DEFAULT false
```

### state (новая)
```sql
last_menu TEXT,
last_msgs_json JSONB,
updated_at TIMESTAMPTZ DEFAULT NOW()
```

### events_log (новая)
```sql
event TEXT CHECK (event IN ('onboarding','meal_add','plan_update','reminder_fire','voice_intent','error')),
meta_json JSONB
```

## 🚀 Деплой

### 1. Подготовка окружения

```bash
# Клонируем репозиторий
git clone <repository-url>
cd nut_tg_bot

# Устанавливаем зависимости
npm install

# Настраиваем переменные окружения
cp .env.example .env
```

### 2. Переменные окружения

```env
TELEGRAM_BOT_TOKEN=your_bot_token
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
DATABASE_URL=your_database_url
```

### 3. Миграция БД

```bash
# Делаем бэкап текущих данных
pg_dump $DATABASE_URL > backup_before_migration.sql

# Выполняем миграцию
chmod +x scripts/migrate.sh
./scripts/migrate.sh
```

### 4. Деплой функций Supabase

```bash
# Деплой основного бота
supabase functions deploy telegram-webhook

# Деплой планировщика напоминаний
supabase functions deploy reminder-cron
```

### 5. Настройка cron job

```bash
# Добавляем задачу в crontab для запуска каждую минуту
echo "* * * * * curl -X POST https://your-project.supabase.co/functions/v1/reminder-cron" | crontab -
```

### 6. Обновление webhook

```bash
# Устанавливаем новый webhook
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-project.supabase.co/functions/v1/telegram-webhook"}'
```

## 🧪 Тестирование

### Smoke-тест

1. **Онбординг**: `/start` → заполнение параметров → расчёт плана
2. **Расчёт**: Проверка корректности BMR/TDEE и макросов
3. **Настройка**: Корректировка макросов с валидацией
4. **Добавление приёма**: Текст, фото, голос
5. **Итог дня**: Корректность агрегации данных
6. **Напоминание**: Получение отчёта в указанное время
7. **Голос**: Распознавание и выполнение команд
8. **Контекст**: Сохранение предпочтений и истории

### Команды для тестирования

```bash
# Проверка структуры БД
psql $DATABASE_URL -c "\dt"

# Проверка данных
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM plans WHERE is_active = true;"

# Проверка функций
curl -X POST https://your-project.supabase.co/functions/v1/telegram-webhook \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "/start", "chat": {"id": 123}, "from": {"id": 123}}}'

# Проверка планировщика
curl -X POST https://your-project.supabase.co/functions/v1/reminder-cron
```

## 📊 Мониторинг

### Логи событий

```sql
-- Активные пользователи за неделю
SELECT COUNT(DISTINCT user_id) FROM events_log 
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Топ событий
SELECT event, COUNT(*) FROM events_log 
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY event ORDER BY COUNT(*) DESC;

-- Использование голоса
SELECT COUNT(*) FROM events_log 
WHERE event = 'voice_intent' AND created_at >= NOW() - INTERVAL '7 days';
```

### Метрики для дашборда

- **Активные пользователи** за период
- **События** по типам
- **Средний дефицит** калорий
- **Частые корректировки** планов
- **Успешность напоминаний**
- **Использование голоса**

## 🔧 Конфигурация

### Тон общения (C.I.D.)

- **Coach** 💪: Мотивационный, энергичный
- **Mentor** 🎯: Наставнический, поддерживающий  
- **Neutral** 📊: Нейтральный, информативный

### Настройки напоминаний

- **day_report**: Отчёт дня (по умолчанию 21:00)
- **meal**: Напоминание о приёме пищи
- **weigh**: Напоминание о взвешивании

### Лимиты

- **Голосовые сообщения**: до 120 секунд
- **Контекст**: последние 10 сообщений
- **История приёмов**: 7 дней
- **Обратная связь**: 20 записей

## 🐛 Устранение неполадок

### Частые проблемы

1. **Ошибки миграции**: Проверить права доступа к БД
2. **Не работают напоминания**: Проверить cron job и функции
3. **Ошибки голосового ввода**: Проверить OpenAI API ключ
4. **Проблемы с контекстом**: Проверить таблицу state

### Логи

```bash
# Логи Supabase функций
supabase functions logs telegram-webhook
supabase functions logs reminder-cron

# Логи БД
psql $DATABASE_URL -c "SELECT * FROM events_log WHERE event = 'error' ORDER BY created_at DESC LIMIT 10;"
```

## 📈 Планы развития

- [ ] **Интеграция с Apple Health**
- [ ] **Рецепты** с КБЖУ
- [ ] **Социальные функции** (друзья, соревнования)
- [ ] **Экспорт данных** (CSV, PDF)
- [ ] **Мультиязычность** (EN, ES, DE)
- [ ] **API** для сторонних приложений

## 📞 Поддержка

При возникновении проблем:

1. Проверьте логи событий в `events_log`
2. Убедитесь в корректности переменных окружения
3. Проверьте статус функций Supabase
4. Создайте issue в репозитории

---

**Версия**: 2.0  
**Дата**: 2024  
**Статус**: Production Ready ✅
