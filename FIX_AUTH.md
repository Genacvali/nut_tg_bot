# ❌ ПРОБЛЕМА НАЙДЕНА: Требуется авторизация

Функция требует authorization header, но Telegram webhook не отправляет его.

## 🔧 РЕШЕНИЕ: Отключить авторизацию

### В Supabase Dashboard:

1. Edge Functions → `telegram-webhook`
2. Settings (настройки функции)
3. Найдите "Verify JWT"
4. Переключите на **OFF** (отключено)
5. Сохраните

ИЛИ

### Добавьте в начало функции проверку:

Обновите код функции, добавив в самое начало:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

serve(async (req) => {
  // Разрешаем запросы от Telegram без авторизации
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    // ... остальной код без изменений
```

---

## ⚡ БЫСТРОЕ РЕШЕНИЕ

Самый простой способ - отключить JWT верификацию в настройках функции.
