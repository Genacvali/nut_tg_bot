"""
Главный файл запуска Telegram бота AI Ассистента по КБЖУ
"""
import asyncio
import logging
import os
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
    ContextTypes
)

# Импорты сервисов
from src.services.supabase_service import SupabaseService
from src.services.openai_service import OpenAIService
from src.services.voice_service import VoiceService
from src.database.queries import DatabaseQueries
from src.config import SUPABASE_URL, SUPABASE_KEY

# Импорты обработчиков
from src.bot.handlers.start import start_command, main_menu_callback, help_command
from src.bot.handlers.profile import (
    profile_callback,
    edit_profile_callback,
    update_weight_callback,
    handle_profile_age,
    handle_gender_callback,
    handle_profile_height,
    handle_profile_current_weight,
    handle_profile_target_weight,
    handle_activity_callback,
    handle_goal_callback,
    handle_method_callback
)
from src.bot.handlers.food_logging import (
    log_food_callback,
    handle_food_description,
    confirm_food_callback,
    cancel_food_callback,
    today_stats_callback,
    handle_voice_message
)
from src.bot.handlers.meal_planning import (
    meal_suggestions_callback,
    handle_meal_request,
    nutrition_plan_callback,
    adjust_plan_callback,
    handle_adjust_request,
    recalculate_plan_callback,
    ai_chat_callback,
    handle_ai_chat
)
from src.bot.handlers.settings import settings_callback
from src.bot.states import BotState

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

async def route_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Маршрутизация текстовых сообщений в зависимости от состояния"""
    state = context.user_data.get('state', BotState.IDLE)
    
    # Состояния профиля
    if state == BotState.PROFILE_AGE:
        await handle_profile_age(update, context)
    elif state == BotState.PROFILE_HEIGHT:
        await handle_profile_height(update, context)
    elif state == BotState.PROFILE_CURRENT_WEIGHT:
        await handle_profile_current_weight(update, context)
    elif state == BotState.PROFILE_TARGET_WEIGHT:
        await handle_profile_target_weight(update, context)
    
    # Состояния логирования еды
    elif state == BotState.FOOD_LOG_WAITING:
        await handle_food_description(update, context)
    
    # Состояния планирования питания
    elif state == BotState.MEAL_PLAN_REQUEST:
        await handle_meal_request(update, context)
    
    # Корректировка плана
    elif state == BotState.ADJUST_NUTRITION:
        await handle_adjust_request(update, context)
    
    # AI чат
    elif state == BotState.AI_CHAT:
        await handle_ai_chat(update, context)
    
    # По умолчанию - AI чат
    else:
        await handle_ai_chat(update, context)

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик ошибок"""
    logger.error(f"Update {update} caused error {context.error}")
    
    if update and update.effective_message:
        await update.effective_message.reply_text(
            "❌ Произошла ошибка. Попробуй еще раз или напиши /start"
        )

def main():
    """Главная функция запуска бота"""
    logger.info("🚀 Запуск бота...")
    
    # Инициализация Supabase
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("❌ SUPABASE_URL и SUPABASE_KEY должны быть установлены в .env файле!")
        return
    
    supabase_service = SupabaseService(SUPABASE_URL, SUPABASE_KEY)
    supabase_client = supabase_service.get_client()
    
    # Получаем секреты из Supabase (или переменных окружения как fallback)
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
    openai_api_key = os.getenv("OPENAI_API_KEY")
    
    # Пытаемся получить из Supabase если не в env
    if not telegram_token:
        telegram_token = supabase_service.get_secret("TELEGRAM_BOT_TOKEN")
    if not openai_api_key:
        openai_api_key = supabase_service.get_secret("OPENAI_API_KEY")
    
    if not telegram_token:
        logger.error("❌ TELEGRAM_BOT_TOKEN не найден!")
        return
    
    if not openai_api_key:
        logger.error("❌ OPENAI_API_KEY не найден!")
        return
    
    # Инициализация сервисов
    openai_service = OpenAIService(openai_api_key)
    voice_service = VoiceService(openai_api_key)
    db_queries = DatabaseQueries(supabase_client)
    
    # Создание приложения
    application = Application.builder().token(telegram_token).build()
    
    # Сохраняем сервисы в bot_data для доступа в обработчиках
    application.bot_data['db'] = db_queries
    application.bot_data['openai'] = openai_service
    application.bot_data['voice'] = voice_service
    application.bot_data['bot_token'] = telegram_token
    
    # Регистрация обработчиков команд
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    
    # Регистрация обработчиков callback'ов
    application.add_handler(CallbackQueryHandler(main_menu_callback, pattern="^main_menu$"))
    application.add_handler(CallbackQueryHandler(help_command, pattern="^help$"))
    
    # Профиль
    application.add_handler(CallbackQueryHandler(profile_callback, pattern="^profile$"))
    application.add_handler(CallbackQueryHandler(edit_profile_callback, pattern="^edit_profile$"))
    application.add_handler(CallbackQueryHandler(update_weight_callback, pattern="^update_weight$"))
    application.add_handler(CallbackQueryHandler(handle_gender_callback, pattern="^gender_"))
    application.add_handler(CallbackQueryHandler(handle_activity_callback, pattern="^activity_"))
    application.add_handler(CallbackQueryHandler(handle_goal_callback, pattern="^goal_"))
    application.add_handler(CallbackQueryHandler(handle_method_callback, pattern="^method_"))
    
    # Логирование еды
    application.add_handler(CallbackQueryHandler(log_food_callback, pattern="^log_food$"))
    application.add_handler(CallbackQueryHandler(confirm_food_callback, pattern="^confirm_food_"))
    application.add_handler(CallbackQueryHandler(cancel_food_callback, pattern="^cancel_food$"))
    application.add_handler(CallbackQueryHandler(today_stats_callback, pattern="^today_stats$"))
    
    # Планирование питания
    application.add_handler(CallbackQueryHandler(nutrition_plan_callback, pattern="^nutrition_plan$"))
    application.add_handler(CallbackQueryHandler(meal_suggestions_callback, pattern="^meal_suggestions$"))
    application.add_handler(CallbackQueryHandler(adjust_plan_callback, pattern="^adjust_plan$"))
    application.add_handler(CallbackQueryHandler(recalculate_plan_callback, pattern="^recalculate_plan$"))
    application.add_handler(CallbackQueryHandler(ai_chat_callback, pattern="^ai_chat$"))
    
    # Настройки
    application.add_handler(CallbackQueryHandler(settings_callback, pattern="^settings$"))
    
    # Обработчики сообщений
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, route_text_message))
    application.add_handler(MessageHandler(filters.VOICE, handle_voice_message))
    
    # Обработчик ошибок
    application.add_error_handler(error_handler)
    
    # Запуск бота
    logger.info("✅ Бот успешно запущен и готов к работе!")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
