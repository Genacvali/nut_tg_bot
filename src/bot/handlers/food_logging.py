"""
Обработчики для логирования приемов пищи
"""
from telegram import Update
from telegram.ext import ContextTypes
from src.bot.keyboards.inline import InlineKeyboards
from src.bot.states import BotState
from datetime import datetime, date
import logging

logger = logging.getLogger(__name__)

async def log_food_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начать логирование еды"""
    query = update.callback_query
    await query.answer()
    
    message = """🍽 ЗАПИСЬ О ЕДЕ

Опиши что ты съел(а). Можешь:

📝 Написать текстом
🎤 Отправить голосовое сообщение

Примеры:
• "Овсянка с бананом и орехами"
• "Куриная грудка 150г, гречка 100г, овощной салат"
• "Два яйца, тост с авокадо"

Постарайся указать примерное количество для точного подсчета КБЖУ."""
    
    context.user_data['state'] = BotState.FOOD_LOG_WAITING
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.back_to_menu()
    )

async def handle_food_description(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка текстового описания еды"""
    description = update.message.text
    
    # Отправляем на анализ в AI
    await update.message.reply_text("⏳ Анализирую еду и рассчитываю КБЖУ...")
    
    try:
        openai_service = context.bot_data['openai']
        food_analysis = await openai_service.analyze_food(description)
        
        # Сохраняем данные для подтверждения
        context.user_data['pending_food'] = {
            'description': description,
            'food_name': food_analysis.get('food_name', description),
            'calories': food_analysis.get('calories', 0),
            'protein': food_analysis.get('protein', 0),
            'fats': food_analysis.get('fats', 0),
            'carbs': food_analysis.get('carbs', 0),
            'portion_note': food_analysis.get('portion_note', '')
        }
        
        # Показываем результат анализа
        message = f"""📊 АНАЛИЗ ЕДЫ

🍽 {food_analysis['food_name']}

Примерное содержание:
🔥 Калории: {food_analysis['calories']} ккал
🥩 Белки: {food_analysis['protein']} г
🥑 Жиры: {food_analysis['fats']} г
🍞 Углеводы: {food_analysis['carbs']} г

📝 {food_analysis['portion_note']}

Подтверждаешь запись?"""
        
        context.user_data['state'] = BotState.FOOD_LOG_CONFIRM
        
        await update.message.reply_text(
            message,
            reply_markup=InlineKeyboards.food_log_confirm({})
        )
        
    except Exception as e:
        logger.error(f"Ошибка анализа еды: {e}")
        await update.message.reply_text(
            "❌ Не удалось проанализировать еду. Попробуй описать подробнее.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

async def confirm_food_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Подтверждение и сохранение записи о еде"""
    query = update.callback_query
    await query.answer()
    
    pending_food = context.user_data.get('pending_food')
    if not pending_food:
        await query.edit_message_text("❌ Ошибка: данные не найдены")
        return
    
    # Сохраняем в БД
    db = context.bot_data['db']
    user_id = context.user_data['user_id']
    
    food_log_data = {
        'user_id': user_id,
        'description': pending_food['description'],
        'calories': pending_food['calories'],
        'protein': pending_food['protein'],
        'fats': pending_food['fats'],
        'carbs': pending_food['carbs'],
        'logged_at': datetime.now().isoformat()
    }
    
    try:
        await db.create_food_log(food_log_data)
        
        # Получаем статистику за сегодня
        today_summary = await db.get_food_logs_summary(user_id, date.today())
        
        # Получаем план питания
        nutrition_plan = await db.get_active_nutrition_plan(user_id)
        
        if nutrition_plan:
            remaining_calories = nutrition_plan['calories'] - today_summary['calories']
            remaining_protein = nutrition_plan['protein'] - today_summary['protein']
            remaining_fats = nutrition_plan['fats'] - today_summary['fats']
            remaining_carbs = nutrition_plan['carbs'] - today_summary['carbs']
            
            message = f"""✅ ЗАПИСЬ ДОБАВЛЕНА!

📊 СТАТИСТИКА НА СЕГОДНЯ:

Употреблено:
🔥 Калории: {today_summary['calories']:.0f} / {nutrition_plan['calories']} ккал
🥩 Белки: {today_summary['protein']:.1f} / {nutrition_plan['protein']} г
🥑 Жиры: {today_summary['fats']:.1f} / {nutrition_plan['fats']} г
🍞 Углеводы: {today_summary['carbs']:.1f} / {nutrition_plan['carbs']} г

Осталось:
🔥 {remaining_calories:.0f} ккал
🥩 {remaining_protein:.1f} г
🥑 {remaining_fats:.1f} г
🍞 {remaining_carbs:.1f} г
"""
        else:
            message = f"""✅ ЗАПИСЬ ДОБАВЛЕНА!

Употреблено сегодня:
🔥 {today_summary['calories']:.0f} ккал
🥩 {today_summary['protein']:.1f} г
🥑 {today_summary['fats']:.1f} г
🍞 {today_summary['carbs']:.1f} г
"""
        
        context.user_data['state'] = BotState.IDLE
        context.user_data.pop('pending_food', None)
        
        await query.edit_message_text(
            text=message,
            reply_markup=InlineKeyboards.main_menu()
        )
        
    except Exception as e:
        logger.error(f"Ошибка сохранения записи о еде: {e}")
        await query.edit_message_text(
            "❌ Ошибка сохранения записи. Попробуй еще раз.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

async def cancel_food_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Отмена записи о еде"""
    query = update.callback_query
    await query.answer()
    
    context.user_data['state'] = BotState.IDLE
    context.user_data.pop('pending_food', None)
    
    await query.edit_message_text(
        "❌ Запись отменена",
        reply_markup=InlineKeyboards.main_menu()
    )

async def today_stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показать статистику за сегодня"""
    query = update.callback_query
    await query.answer()
    
    db = context.bot_data['db']
    user_id = context.user_data['user_id']
    
    # Получаем записи за сегодня
    today_logs = await db.get_food_logs_by_date(user_id, date.today())
    today_summary = await db.get_food_logs_summary(user_id, date.today())
    
    # Получаем план питания
    nutrition_plan = await db.get_active_nutrition_plan(user_id)
    
    if not nutrition_plan:
        await query.edit_message_text(
            "⚠️ У тебя еще нет плана питания. Создай профиль сначала!",
            reply_markup=InlineKeyboards.back_to_menu()
        )
        return
    
    # Формируем сообщение
    message = f"""📅 СТАТИСТИКА НА СЕГОДНЯ

📊 Твоя норма:
🔥 {nutrition_plan['calories']} ккал
🥩 {nutrition_plan['protein']} г белка
🥑 {nutrition_plan['fats']} г жиров
🍞 {nutrition_plan['carbs']} г углеводов

✅ Употреблено:
🔥 {today_summary['calories']:.0f} ккал ({(today_summary['calories']/nutrition_plan['calories']*100):.0f}%)
🥩 {today_summary['protein']:.1f} г ({(today_summary['protein']/nutrition_plan['protein']*100):.0f}%)
🥑 {today_summary['fats']:.1f} г ({(today_summary['fats']/nutrition_plan['fats']*100):.0f}%)
🍞 {today_summary['carbs']:.1f} г ({(today_summary['carbs']/nutrition_plan['carbs']*100):.0f}%)

📝 Записей за сегодня: {today_summary['count']}
"""
    
    # Добавляем последние записи
    if today_logs:
        message += "\n🕐 Последние приемы пищи:\n"
        for log in today_logs[-5:]:  # Последние 5
            time = datetime.fromisoformat(log['logged_at']).strftime("%H:%M")
            message += f"• {time} - {log['description'][:50]}...\n"
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.today_stats_actions()
    )

async def handle_voice_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка голосовых сообщений"""
    voice = update.message.voice
    
    await update.message.reply_text("🎤 Обрабатываю голосовое сообщение...")
    
    try:
        # Получаем файл
        file = await context.bot.get_file(voice.file_id)
        file_path = f"temp_voice_{update.effective_user.id}.ogg"
        
        # Скачиваем и транскрибируем
        voice_service = context.bot_data['voice']
        bot_token = context.bot_data['bot_token']
        
        success = await voice_service.download_voice_file(
            file.file_path,
            file_path,
            bot_token
        )
        
        if not success:
            await update.message.reply_text("❌ Не удалось скачать голосовое сообщение")
            return
        
        text = await voice_service.transcribe_voice(file_path)
        
        if not text:
            await update.message.reply_text("❌ Не удалось распознать речь. Попробуй еще раз.")
            return
        
        # Отправляем распознанный текст
        await update.message.reply_text(f"📝 Распознано: \"{text}\"")
        
        # Определяем намерение пользователя
        current_state = context.user_data.get('state', BotState.IDLE)
        
        if current_state == BotState.FOOD_LOG_WAITING:
            # Это запись о еде
            update.message.text = text
            await handle_food_description(update, context)
        elif current_state == BotState.MEAL_PLAN_REQUEST:
            # Это запрос на планирование питания
            update.message.text = text
            await handle_meal_request(update, context)
        else:
            # Общий AI чат
            openai_service = context.bot_data['openai']
            response = await openai_service.general_chat(text)
            await update.message.reply_text(response, reply_markup=InlineKeyboards.back_to_menu())
        
    except Exception as e:
        logger.error(f"Ошибка обработки голосового сообщения: {e}")
        await update.message.reply_text(
            "❌ Ошибка обработки голосового сообщения",
            reply_markup=InlineKeyboards.back_to_menu()
        )

# Импортируем из meal_planning для избежания циклического импорта
async def handle_meal_request(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Временная заглушка, будет реализовано в meal_planning.py"""
    pass

