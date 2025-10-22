#!/bin/bash

echo "🚀 Настройка webhook для Telegram бота"
echo ""

# Инструкция по получению токена
echo "1. Откройте Supabase Dashboard"
echo "2. Settings → Edge Functions → Secrets"
echo "3. Найдите TELEGRAM_BOT_TOKEN"
echo "4. Скопируйте токен"
echo ""
read -p "Вставьте токен бота: " TOKEN

if [ -z "$TOKEN" ]; then
    echo "❌ Токен не введен"
    exit 1
fi

echo ""
echo "📡 Настройка webhook..."

# Настройка webhook
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://itlqgwevcuoysdmuttwy.supabase.co/functions/v1/telegram-webhook"}')

echo "Ответ: $RESPONSE"
echo ""

# Проверка webhook
echo "🔍 Проверка webhook..."
WEBHOOK_INFO=$(curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo")
echo "$WEBHOOK_INFO" | python3 -m json.tool 2>/dev/null || echo "$WEBHOOK_INFO"

echo ""
echo "✅ Готово! Отправьте /start боту в Telegram"
