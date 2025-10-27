# 🚀 Быстрый деплой dev-bot

## 1️⃣ Задеплой функцию (2 минуты)

1. Открой [Supabase Dashboard](https://supabase.com/dashboard)
2. Выбери проект: `itlqgwevcuoysdmuttwy`
3. **Edge Functions** → **Create a new function**
4. Название: `dev-bot`
5. Скопируй весь код из `supabase/functions/dev-bot/index.ts`
6. Нажми **Deploy**

---

## 2️⃣ Настрой webhook (30 секунд)

```bash
curl -X POST "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/dev-bot"}'
```

**Ожидаемый ответ:**
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

## 3️⃣ Проверь что работает (1 минута)

1. Открой [@cid_tg_admin_bot](https://t.me/cid_tg_admin_bot)
2. Отправь `/start`
3. Бот должен ответить приветствием

---

## ✅ Готово!

Теперь можешь тестировать UI/UX изменения на dev-боте перед деплоем на прод.

---

## 🔄 Обновление dev-bot

Когда внес изменения в код:

1. Открой **Edge Functions** → `dev-bot`
2. Обнови код
3. Нажми **Deploy**
4. Тестируй в боте

---

## 🐛 Если что-то не работает:

### Проверь webhook:
```bash
curl "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/getWebhookInfo"
```

### Посмотри логи:
- Supabase Dashboard → Edge Functions → dev-bot → Logs

### Удали webhook и установи заново:
```bash
curl "https://api.telegram.org/bot8495765381:AAGLfXvTCNHX-fXXgrHRl4oTh8JYiHBOzns/deleteWebhook"
# Потом установи заново (команда из шага 2)
```

---

**🧪 Начинай тестировать!**
