"""
Обработчик команды /start и главное меню
"""
from telegram import Update
from telegram.ext import ContextTypes
from src.bot.keyboards.inline import InlineKeyboards
import logging

logger = logging.getLogger(__name__)

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start"""
    user = update.effective_user
    
    # Получаем или создаем пользователя в БД
    db = context.bot_data['db']
    user_data = await db.get_or_create_user(
        telegram_id=user.id,
        username=user.username,
        first_name=user.first_name
    )
    
    # Сохраняем ID пользователя в контексте
    context.user_data['user_id'] = user_data['id']
    
    # Проверяем, есть ли у пользователя профиль
    profile = await db.get_user_profile(user_data['id'])
    
    welcome_message = """🤖 Привет! Я C.I.D. — Care • Insight • Discipline.
Твой AI-наставник по питанию и привычкам.
Я помогу тебе рассчитать рацион, вести учёт и не терять фокус."""
    
    if not profile:
        keyboard = [[InlineKeyboardButton("✨ Заполнить профиль", callback_data="fill_profile")]]
        from telegram import InlineKeyboardMarkup
        await update.message.reply_text(
            welcome_message,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        welcome_message += "\n\n✅ Твой профиль уже создан!"
        keyboard = [
            [InlineKeyboardButton("📊 Мой план КБЖУ", callback_data="show_card")],
            [InlineKeyboardButton("✏️ Редактировать профиль", callback_data="edit_profile")]
        ]
        from telegram import InlineKeyboardMarkup
        await update.message.reply_text(
            welcome_message,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    
    logger.info(f"Пользователь {user.id} ({user.username}) запустил бота")

async def main_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Возврат в главное меню"""
    query = update.callback_query
    await query.answer()
    
    message = """🏠 Главное меню

Выбери действие:"""
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.main_menu()
    )

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /help"""
    help_text = """ℹ️ ПОМОЩЬ

🔹 Основные функции:

📊 Мой профиль - управление личными данными
🎯 Мой план КБЖУ - просмотр и корректировка плана питания
🍽 Записать еду - добавить запись о приеме пищи (текст или голос)
📅 Сегодняшняя статистика - прогресс за день
👨‍🍳 Что приготовить? - получить рекомендации по питанию
💬 Спросить AI - задать вопрос ассистенту

🔹 Голосовые сообщения:
Отправь голосовое сообщение, чтобы:
- Записать что ты съел
- Спросить что приготовить
- Получить рекомендации

🔹 Команды:
/start - главное меню
/help - эта справка
/profile - быстрый доступ к профилю
/today - статистика за сегодня

💡 Совет: Все взаимодействие с ботом интуитивно понятно - просто следуй подсказкам!
"""
    
    if update.message:
        await update.message.reply_text(help_text, reply_markup=InlineKeyboards.back_to_menu())
    else:
        query = update.callback_query
        await query.answer()
        await query.edit_message_text(text=help_text, reply_markup=InlineKeyboards.back_to_menu())

