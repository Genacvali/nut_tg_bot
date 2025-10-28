# 🤖 AI Conversation Memory - Deployment Guide

## 📋 Что это?

Умная система разговоров с AI-ассистентом с памятью контекста, как ChatGPT!

**Возможности:**
- ✅ AI определяет намерение с учетом контекста (GPT-4o-mini)
- ✅ Помнит историю разговора
- ✅ Понимает продолжение диалога
- ✅ Спрашивает подтверждение когда неуверен
- ✅ Автоматическая очистка старых сообщений

---

## 🚀 Деплой (5 минут)

### Шаг 1: SQL миграция (2 минуты)

В Supabase SQL Editor выполни:

```sql
-- Файл: supabase/migration/add_conversation_memory.sql
-- Скопируй весь код из файла и выполни
```

**Проверка:**
```sql
-- Должны вернуться без ошибок:
SELECT * FROM conversation_history LIMIT 1;
SELECT get_recent_messages(1, 5);
SELECT get_conversation_topic(1);
```

---

### Шаг 2: Обновить dev-bot (3 минуты)

1. Скопируй обновленный код из `/home/gena1/nut_tg_bot/supabase/functions/dev-bot/index.ts`
2. В Supabase Dashboard → Edge Functions → dev-bot
3. Вставь код
4. Deploy

**Что добавлено:**
- `ConversationManager` класс
- `detectIntentWithContext()` - AI определение намерений
- Интерфейсы: `ConversationMessage`, `IntentResult`, `ConversationTopic`

---

## 🧪 Тестирование

### Тест 1: Явное логирование
```
User: "съел 200г курицы"
Expected: ✅ Записал без вопросов
```

### Тест 2: Явный вопрос
```
User: "что лучше есть перед тренировкой?"
Expected: 💬 Ответ консультанта
```

### Тест 3: Неясный случай
```
User: "салат"
Expected: ❓ "Что ты хотел сделать?" + кнопки подтверждения
```

### Тест 4: Продолжение диалога
```
User: "что поесть перед тренировкой?"
Bot: "За 1-2 часа до тренировки..."
User: "а после?"
Expected: 💬 Понимает контекст, отвечает про питание после тренировки
```

### Тест 5: Таймаут контекста
```
Подожди 30 минут бездействия
User: любое сообщение
Expected: Контекст очищен, работает как новая сессия
```

---

## 📊 SQL функции

### 1. Добавить сообщение
```sql
SELECT add_conversation_message(
  42,                -- user_id
  'user',            -- role
  'Съел курицу',     -- content
  'food',            -- intent (optional)
  0.95               -- confidence (optional)
);
```

### 2. Получить историю
```sql
SELECT * FROM get_recent_messages(42, 10);
```

### 3. Определить тему
```sql
SELECT get_conversation_topic(42);

-- Пример ответа:
{
  "topic": "question",
  "confidence": 0.9,
  "messages_count": 3,
  "is_active": true,
  "last_message_at": "2025-10-27T18:30:00Z"
}
```

### 4. Очистить историю
```sql
-- Мягкое удаление (можно восстановить)
SELECT clear_conversation_history(42, false);

-- Полное удаление
SELECT clear_conversation_history(42, true);
```

### 5. Автоочистка старых сообщений
```sql
-- Удаляет сообщения старше 30 дней
SELECT cleanup_old_conversations();
```

---

## 🔧 TypeScript API (dev-bot)

### ConversationManager

```typescript
// Получить последние 5 сообщений
const history = await ConversationManager.getRecentMessages(userId, 5)

// Добавить сообщение пользователя
await ConversationManager.addMessage(
  userId,
  'user',
  'Что лучше есть перед тренировкой?',
  'question',
  0.95
)

// Добавить ответ ассистента
await ConversationManager.addMessage(
  userId,
  'assistant',
  'Перед тренировкой за 1-2 часа хороши углеводы...'
)

// Получить текущую тему
const topic = await ConversationManager.getCurrentTopic(userId)

// Очистить контекст
await ConversationManager.clearContext(userId)

// Проверить и очистить устаревший контекст
await ConversationManager.checkAndClearIfStale(userId)
```

### detectIntentWithContext

```typescript
const text = "а после тренировки?"
const history = await ConversationManager.getRecentMessages(userId, 5)

const result = await detectIntentWithContext(text, userId, history)

console.log(result)
// {
//   intent: 'question',
//   confidence: 0.92,
//   reasoning: 'Продолжение вопроса о питании при тренировках',
//   needsConfirmation: false
// }
```

---

## 💰 Стоимость OpenAI API

**GPT-4o-mini:**
- Input: $0.15 / 1M tokens
- Output: $0.60 / 1M tokens

**Один запрос detectIntentWithContext:**
- ~200 input tokens (~$0.00003)
- ~50 output tokens (~$0.00003)
- **Итого: ~$0.00006 за запрос**

**1000 сообщений = $0.06 (6 копеек)**

---

## 🎯 Следующие шаги

### ✅ Готово:
1. SQL миграция с историей
2. ConversationManager класс
3. AI Intent Detection с контекстом

### 🚧 В разработке:
4. Confirmation UI (кнопки подтверждения)
5. Интеграция в handleTextMessage
6. Контекстные кнопки после ответов

---

## 🐛 Troubleshooting

### Ошибка: "function get_recent_messages does not exist"
**Решение:** Выполни SQL миграцию из `add_conversation_memory.sql`

### Ошибка: "Invalid OpenAI response"
**Причины:**
1. Нет OPENAI_API_KEY в env
2. Израсходован лимит API
3. Неправильный формат ответа

**Решение:** Проверь env переменные и баланс OpenAI

### AI часто ошибается с намерениями
**Решение:** Увеличь количество примеров в промпте или измени `temperature` (сейчас 0.3)

### Контекст не очищается автоматически
**Решение:** Убедись что вызывается `ConversationManager.checkAndClearIfStale()` в начале handleTextMessage

---

**🎉 Готово! AI-ассистент с памятью работает!**
