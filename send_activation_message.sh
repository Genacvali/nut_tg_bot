#!/bin/bash

# Получаем переменные из .env
source .env

TELEGRAM_ID="148767610"
MESSAGE="🎉 *Спасибо за поддержку!*

✅ Подписка активирована успешно!

📦 *План:* Месячная подписка
📅 *Активна до:* $(date -d '+30 days' '+%d %B %Y')
⏰ *Осталось:* 30 дней

Все функции бота теперь доступны! 🚀"

# Отправка сообщения через Telegram Bot API
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{
    \"chat_id\": ${TELEGRAM_ID},
    \"text\": \"${MESSAGE}\",
    \"parse_mode\": \"Markdown\"
  }"

echo -e "\n✅ Уведомление отправлено!"

