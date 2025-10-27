# 🧪 DEV BOT - Быстрый деплой

## 📋 Информация

**Bot:** @cid_tg_admin_bot
**Token:** `8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns`
**Webhook URL:** `https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/dev-bot`

---

## 🚀 Как задеплоить (3 шага)

### Шаг 1: Создай функцию в Supabase

1. Открой https://supabase.com/dashboard/project/itlqgwevcuoysdmuttwy/functions
2. Нажми **"New Edge Function"**
3. Название: `dev-bot`
4. Скопируй **ВЕСЬ** код из файла `supabase/functions/dev-bot/index.ts`
5. Нажми **Deploy**

**⚠️ Важно:** В коде уже прописан токен dev-бота (строка 52):
```typescript
const TELEGRAM_BOT_TOKEN = '8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns'
```

### Шаг 2: Webhook уже настроен ✅

Я уже установил webhook для dev-бота. Проверить можно так:

```bash
curl "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/getWebhookInfo"
```

Должен вернуть:
```json
{
  "url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/dev-bot"
}
```

### Шаг 3: Протестируй

1. Открой https://t.me/cid_tg_admin_bot
2. Отправь `/start`
3. Бот должен ответить

---

## 🔧 Альтернатива: Deploy через CLI (если есть Supabase CLI)

```bash
# В корне проекта
supabase functions deploy dev-bot

# Или только dev-bot
cd supabase/functions/dev-bot
supabase functions deploy
```

---

## 🐛 Troubleshooting

### Бот не отвечает после деплоя:

#### 1. Проверь что функция задеплоилась:
- Supabase Dashboard → Edge Functions → dev-bot
- Статус должен быть "Active" или "Deployed"

#### 2. Проверь логи:
- Supabase Dashboard → Edge Functions → dev-bot → Logs
- Отправь `/start` боту и сразу смотри логи

#### 3. Проверь webhook:
```bash
curl "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/getWebhookInfo"
```

#### 4. Переустанови webhook (если нужно):
```bash
# Удали
curl "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/deleteWebhook"

# Установи заново
curl -X POST "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/dev-bot"}'
```

#### 5. Проверь что токен правильный в коде:
```bash
# В терминале
grep "TELEGRAM_BOT_TOKEN" supabase/functions/dev-bot/index.ts
```

Должно показать:
```typescript
const TELEGRAM_BOT_TOKEN = '8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns'
```

---

## 📝 Примечания

### Отличия dev-bot от prod-bot:

1. **Токен:** Хардкод в коде (строка 52)
2. **База данных:** Та же самая (будь осторожен!)
3. **OpenAI API:** Тот же ключ (тратит токены)
4. **Функционал:** Полностью идентичный

### Для чего использовать dev-bot:

- ✅ Тестирование новых UI элементов
- ✅ Проверка UX flows
- ✅ Отладка inline keyboards
- ✅ Тестирование новых фич
- ❌ НЕ для production use

---

## ✅ После успешного деплоя:

1. Бот отвечает на `/start` ✅
2. Все функции работают ✅
3. Можно тестировать новые фичи ✅

**Готово! Начинай тестировать!** 🧪
