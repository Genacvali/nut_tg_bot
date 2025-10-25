#!/bin/bash

# ============================================
# СКРИПТ ДЛЯ ОТПРАВКИ БЛАГОДАРСТВЕННЫХ СООБЩЕНИЙ
# ============================================

echo "🎉 Награждаем ранних пользователей..."
echo ""

# Шаг 1: Применяем миграцию (выдаём unlimited подписки)
echo "📝 Шаг 1: Выдаём безлимитные подписки..."
supabase db push

echo ""
echo "⏳ Ждём 2 секунды..."
sleep 2

# Шаг 2: Деплоим функцию отправки сообщений
echo "📦 Шаг 2: Деплоим функцию отправки сообщений..."
supabase functions deploy send-thank-you-messages --no-verify-jwt

echo ""
echo "⏳ Ждём 2 секунды..."
sleep 2

# Шаг 3: Вызываем функцию для отправки сообщений
echo "📨 Шаг 3: Отправляем благодарственные сообщения..."
echo ""

# Получаем URL проекта
SUPABASE_URL=$(supabase status | grep "API URL" | awk '{print $3}')
SUPABASE_KEY=$(supabase status | grep "service_role key" | awk '{print $3}')

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo "❌ Не удалось получить URL или ключ Supabase"
  echo "Вызови функцию вручную через Supabase Dashboard"
  exit 1
fi

# Вызываем функцию
curl -i --location --request POST "${SUPABASE_URL}/functions/v1/send-thank-you-messages" \
  --header "Authorization: Bearer ${SUPABASE_KEY}" \
  --header "Content-Type: application/json"

echo ""
echo ""
echo "✅ Готово! Проверь результаты выше."
echo ""
echo "📊 Также можешь посмотреть логи:"
echo "   supabase functions logs send-thank-you-messages"

