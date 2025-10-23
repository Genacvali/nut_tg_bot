"""
Обработчики для планирования питания и рекомендаций
"""
from telegram import Update
from telegram.ext import ContextTypes
from src.bot.keyboards.inline import InlineKeyboards
from src.bot.states import BotState
from datetime import date
import logging

logger = logging.getLogger(__name__)

async def meal_suggestions_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Получение рекомендаций по питанию"""
    query = update.callback_query
    await query.answer()
    
    message = """👨‍🍳 ЧТО ПРИГОТОВИТЬ?

Расскажи мне:
• Что у тебя есть в холодильнике?
• Что ты хочешь съесть?
• Какой прием пищи планируешь?

Я подберу рецепт, который впишется в твою норму КБЖУ!

📝 Можешь написать текстом или 🎤 отправить голосовым сообщением."""
    
    context.user_data['state'] = BotState.MEAL_PLAN_REQUEST
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.back_to_menu()
    )

async def handle_meal_request(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка запроса на планирование питания"""
    user_request = update.message.text
    
    await update.message.reply_text("👨‍🍳 Подбираю идеальное блюдо для тебя...")
    
    try:
        db = context.bot_data['db']
        user_id = context.user_data['user_id']
        
        # Получаем план питания
        nutrition_plan = await db.get_active_nutrition_plan(user_id)
        
        if not nutrition_plan:
            await update.message.reply_text(
                "⚠️ У тебя еще нет плана питания. Создай профиль сначала!",
                reply_markup=InlineKeyboards.back_to_menu()
            )
            return
        
        # Получаем статистику за сегодня
        today_summary = await db.get_food_logs_summary(user_id, date.today())
        
        # Запрашиваем рекомендацию у AI
        openai_service = context.bot_data['openai']
        
        meal_suggestion = await openai_service.suggest_meal(
            user_request=user_request,
            nutrition_plan={
                'calories': nutrition_plan['calories'],
                'protein': nutrition_plan['protein'],
                'fats': nutrition_plan['fats'],
                'carbs': nutrition_plan['carbs']
            },
            daily_consumed=today_summary
        )
        
        # Формируем ответ
        fits_emoji = "✅" if meal_suggestion.get('fits_plan', True) else "⚠️"
        
        message = f"""👨‍🍳 РЕКОМЕНДАЦИЯ

{fits_emoji} **{meal_suggestion['meal_name']}**

📝 {meal_suggestion['description']}

🛒 Ингредиенты:
{meal_suggestion['ingredients']}

👩‍🍳 Приготовление:
{meal_suggestion['cooking_instructions']}

📊 КБЖУ порции:
🔥 {meal_suggestion['calories']} ккал
🥩 {meal_suggestion['protein']} г белка
🥑 {meal_suggestion['fats']} г жиров
🍞 {meal_suggestion['carbs']} г углеводов

💡 {meal_suggestion['recommendation_note']}
"""
        
        # Сохраняем рекомендацию в БД
        meal_plan_data = {
            'user_id': user_id,
            'meal_description': meal_suggestion['meal_name'],
            'ingredients': meal_suggestion['ingredients'],
            'calories': meal_suggestion['calories'],
            'protein': meal_suggestion['protein'],
            'fats': meal_suggestion['fats'],
            'carbs': meal_suggestion['carbs'],
            'created_by_ai': True
        }
        
        await db.create_meal_plan(meal_plan_data)
        
        context.user_data['state'] = BotState.IDLE
        
        await update.message.reply_text(
            message,
            reply_markup=InlineKeyboards.back_to_menu(),
            parse_mode='Markdown'
        )
        
    except Exception as e:
        logger.error(f"Ошибка создания рекомендации по питанию: {e}")
        await update.message.reply_text(
            "❌ Не удалось создать рекомендацию. Попробуй еще раз.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

async def nutrition_plan_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показать текущий план питания"""
    query = update.callback_query
    await query.answer()
    
    db = context.bot_data['db']
    user_id = context.user_data['user_id']
    
    nutrition_plan = await db.get_active_nutrition_plan(user_id)
    
    if not nutrition_plan:
        await query.edit_message_text(
            "⚠️ У тебя еще нет плана питания. Создай профиль сначала!",
            reply_markup=InlineKeyboards.back_to_menu()
        )
        return
    
    message = f"""🎯 ТВОЙ ПЛАН ПИТАНИЯ

📊 Дневная норма:
🔥 Калории: {nutrition_plan['calories']} ккал
🥩 Белки: {nutrition_plan['protein']} г
🥑 Жиры: {nutrition_plan['fats']} г
🍞 Углеводы: {nutrition_plan['carbs']} г

📈 Метаболизм:
• Базовый (BMR): {nutrition_plan['bmr']:.0f} ккал/день
• Общий расход (TDEE): {nutrition_plan['tdee']:.0f} ккал/день

{nutrition_plan.get('methodology_explanation', '')}
"""
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.nutrition_plan_actions()
    )

async def adjust_plan_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начать корректировку плана"""
    query = update.callback_query
    await query.answer()
    
    message = """✏️ КОРРЕКТИРОВКА ПЛАНА

Опиши, что ты хочешь изменить в своем плане питания.

Примеры:
• "Хочу увеличить калории на 200"
• "Нужно больше белка"
• "Снизить углеводы"
• "Хочу более агрессивный дефицит"

Я помогу скорректировать план безопасно и эффективно! 💪"""
    
    context.user_data['state'] = BotState.ADJUST_NUTRITION
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.back_to_menu()
    )

async def handle_adjust_request(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка запроса на корректировку плана"""
    user_request = update.message.text
    
    await update.message.reply_text("⏳ Корректирую план с учетом твоих пожеланий...")
    
    try:
        db = context.bot_data['db']
        user_id = context.user_data['user_id']
        
        # Получаем текущий план и профиль
        nutrition_plan = await db.get_active_nutrition_plan(user_id)
        profile = await db.get_user_profile(user_id)
        
        if not nutrition_plan or not profile:
            await update.message.reply_text(
                "❌ Не найден план или профиль",
                reply_markup=InlineKeyboards.back_to_menu()
            )
            return
        
        # Запрашиваем корректировку у AI
        openai_service = context.bot_data['openai']
        
        adjusted_plan = await openai_service.adjust_nutrition_plan(
            current_plan={
                'calories': nutrition_plan['calories'],
                'protein': nutrition_plan['protein'],
                'fats': nutrition_plan['fats'],
                'carbs': nutrition_plan['carbs']
            },
            user_request=user_request,
            user_data={
                'age': profile['age'],
                'gender': profile['gender'],
                'height': profile['height'],
                'weight': profile['current_weight'],
                'goal': profile['goal']
            }
        )
        
        # Обновляем план в БД
        updated_plan_data = {
            'calories': int(adjusted_plan['target_calories']),
            'protein': adjusted_plan['protein_grams'],
            'fats': adjusted_plan['fats_grams'],
            'carbs': adjusted_plan['carbs_grams'],
            'methodology_explanation': f"{nutrition_plan.get('methodology_explanation', '')}\n\n🔄 КОРРЕКТИРОВКА:\n{adjusted_plan['adjustment_explanation']}"
        }
        
        await db.update_nutrition_plan(nutrition_plan['id'], updated_plan_data)
        
        message = f"""✅ ПЛАН СКОРРЕКТИРОВАН!

🎯 НОВЫЙ ПЛАН:
🔥 Калории: {adjusted_plan['target_calories']} ккал
🥩 Белки: {adjusted_plan['protein_grams']} г
🥑 Жиры: {adjusted_plan['fats_grams']} г
🍞 Углеводы: {adjusted_plan['carbs_grams']} г

💡 {adjusted_plan['adjustment_explanation']}
"""
        
        context.user_data['state'] = BotState.IDLE
        
        await update.message.reply_text(
            message,
            reply_markup=InlineKeyboards.main_menu()
        )
        
    except Exception as e:
        logger.error(f"Ошибка корректировки плана: {e}")
        await update.message.reply_text(
            "❌ Не удалось скорректировать план. Попробуй сформулировать по-другому.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

async def recalculate_plan_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Пересчитать план с нуля"""
    query = update.callback_query
    await query.answer()
    
    await query.edit_message_text(
        "🔄 Хочешь пересчитать план с нуля на основе текущего профиля?",
        reply_markup=InlineKeyboards.yes_no("recalculate")
    )

async def ai_chat_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начать общение с AI"""
    query = update.callback_query
    await query.answer()
    
    message = """💬 AI АССИСТЕНТ

Задай мне любой вопрос о питании, здоровье или фитнесе!

Примеры:
• "Как ускорить метаболизм?"
• "Почему я не худею?"
• "Какие продукты богаты белком?"
• "Как правильно считать калории?"

Я здесь, чтобы помочь! 🤖"""
    
    context.user_data['state'] = BotState.AI_CHAT
    
    await query.edit_message_text(
        text=message,
        reply_markup=InlineKeyboards.back_to_menu()
    )

async def handle_ai_chat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка общения с AI"""
    user_message = update.message.text
    
    await update.message.reply_text("🤖 Думаю...")
    
    try:
        openai_service = context.bot_data['openai']
        
        # Получаем контекст разговора (если есть)
        chat_context = context.user_data.get('chat_context', [])
        
        # Добавляем сообщение пользователя
        chat_context.append({"role": "user", "content": user_message})
        
        # Получаем ответ от AI
        response = await openai_service.general_chat(user_message, chat_context[-10:])  # Последние 10 сообщений
        
        # Добавляем ответ в контекст
        chat_context.append({"role": "assistant", "content": response})
        
        # Сохраняем контекст (ограничиваем 20 сообщениями)
        context.user_data['chat_context'] = chat_context[-20:]
        
        await update.message.reply_text(
            response,
            reply_markup=InlineKeyboards.back_to_menu()
        )
        
    except Exception as e:
        logger.error(f"Ошибка AI чата: {e}")
        await update.message.reply_text(
            "❌ Ошибка связи с AI. Попробуй еще раз.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

