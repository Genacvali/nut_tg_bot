"""
Обработчики для настроек бота
"""
from telegram import Update
from telegram.ext import ContextTypes
from src.bot.keyboards.inline import InlineKeyboards
import logging

logger = logging.getLogger(__name__)

async def settings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показать настройки"""
    query = update.callback_query
    await query.answer()
    
    message = """⚙️ НАСТРОЙКИ

🔹 Доступные действия:
• Редактировать профиль
• Изменить метод расчета КБЖУ
• Экспорт данных (скоро)
• Удалить аккаунт

Что хочешь настроить?"""
    
    keyboard = [
        [InlineKeyboardButton("✏️ Редактировать профиль", callback_data="edit_profile")],
        [InlineKeyboardButton("🔄 Пересчитать план", callback_data="recalculate_plan")],
        [InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")]
    ]
    
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

