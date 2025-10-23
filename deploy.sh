#!/bin/bash

# Скрипт для деплоя Telegram бота в Supabase Edge Functions

set -e

echo "🚀 Деплой Telegram AI Ассистента в Supabase..."

# Проверка установки Supabase CLI
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI не установлен!"
    echo "Установите: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "✅ Supabase CLI найден"

# Проверка линка с проектом
if [ ! -f ".supabase/config.toml" ]; then
    echo "⚠️  Проект не связан с Supabase"
    echo "Выполните: supabase link --project-ref your-project-ref"
    exit 1
fi

echo "✅ Проект связан с Supabase"

# Деплой функций
echo ""
echo "📦 Деплой Edge Functions..."

echo "  → Деплой telegram-bot..."
supabase functions deploy telegram-bot --no-verify-jwt

echo "  → Деплой set-webhook..."
supabase functions deploy set-webhook --no-verify-jwt

echo ""
echo "✅ Все функции задеплоены!"

# Получаем URL проекта
PROJECT_URL=$(supabase status | grep "API URL" | awk '{print $3}')

if [ -z "$PROJECT_URL" ]; then
    echo "⚠️  Не удалось получить URL проекта"
    echo "Установите webhook вручную:"
    echo "  https://your-project.supabase.co/functions/v1/set-webhook"
else
    echo ""
    echo "🔗 Установка webhook..."
    
    WEBHOOK_URL="${PROJECT_URL}/functions/v1/set-webhook"
    
    echo "  URL: ${WEBHOOK_URL}"
    
    response=$(curl -s -X POST "${WEBHOOK_URL}")
    
    if echo "$response" | grep -q "success"; then
        echo "✅ Webhook установлен успешно!"
    else
        echo "⚠️  Ошибка установки webhook"
        echo "  Ответ: ${response}"
        echo ""
        echo "Попробуйте установить вручную:"
        echo "  ${WEBHOOK_URL}"
    fi
fi

echo ""
echo "🎉 Деплой завершен!"
echo ""
echo "📊 Проверка статуса:"
echo "  supabase functions list"
echo ""
echo "📝 Просмотр логов:"
echo "  supabase functions logs telegram-bot --tail"
echo ""
echo "✅ Протестируйте бота в Telegram!"

