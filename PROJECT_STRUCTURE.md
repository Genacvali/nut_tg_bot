# 📁 Структура проекта C.I.D. Bot

## Основные файлы
- `README.md` - основная документация проекта
- `ADMIN_GUIDE.md` - руководство администратора
- `DEPLOY.md` - инструкции по деплою

## Supabase Functions
- `telegram-bot/` - основная логика бота
- `tbank-payment/` - создание платежей
- `tbank-webhook/` - обработка webhook'ов от T-Bank
- `send-thank-you-messages/` - отправка благодарственных сообщений
- `notification-scheduler/` - планировщик уведомлений
- `set-webhook/` - установка webhook'а Telegram

## Миграции БД
- `database_schema.sql` - основная схема базы данных
- `admin_subscription_management.sql` - админские функции и view
- `fix_foreign_keys_cascade.sql` - исправления внешних ключей
- `tbank_payments.sql` - схема платежей
- `users_full_info_view.sql` - view для полной информации о пользователях
- `add_billing_tracking.sql` - отслеживание биллинга

## Удаленные файлы (очистка проекта)
- ❌ QUICK_START_TBANK.md
- ❌ SUBSCRIPTION_SETUP_GUIDE.md  
- ❌ WEB_ADMIN_SETUP.md
- ❌ REWARD_USERS_GUIDE.md
- ❌ send_thank_you.sh
- ❌ send_activation_message.sh
- ❌ send_thank_you_to_all.sh
- ❌ activate_payment_manually.sql
- ❌ check_early_users.sql
- ❌ check_payment.sql
- ❌ grant_unlimited_subscription.sql
- ❌ grant_unlimited_to_all.sql
- ❌ reward_early_users.sql

Проект очищен от временных и дублирующих файлов! 🧹✨
