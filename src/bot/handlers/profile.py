"""
Обработчики для работы с профилем пользователя
"""
from telegram import Update
from telegram.ext import ContextTypes
from src.bot.keyboards.inline import InlineKeyboards
from src.bot.states import BotState
from src.utils.validators import DataValidator
from src.utils.calculators import NutritionCalculator
import logging

logger = logging.getLogger(__name__)

async def profile_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показать профиль пользователя"""
    query = update.callback_query
    await query.answer()
    
    db = context.bot_data['db']
    user_id = context.user_data.get('user_id')
    
    profile = await db.get_user_profile(user_id)
    
    if not profile:
        # Профиля нет - начинаем создание
        message = """📊 СОЗДАНИЕ ПРОФИЛЯ

Для расчета индивидуального плана питания мне нужно узнать о тебе больше.

Пожалуйста, укажи свой возраст (в годах):"""
        
        context.user_data['state'] = BotState.PROFILE_AGE
        await query.edit_message_text(text=message)
    else:
        # Показываем существующий профиль
        gender_text = "Мужской" if profile['gender'] == 'male' else "Женский"
        
        activity_names = {
            "sedentary": "Сидячий",
            "light": "Легкая",
            "moderate": "Умеренная",
            "active": "Высокая",
            "very_active": "Очень высокая"
        }
        
        goal_names = {
            "lose": "Похудение",
            "maintain": "Поддержание",
            "gain": "Набор массы"
        }
        
        message = f"""📊 ТВОЙ ПРОФИЛЬ

👤 Пол: {gender_text}
🎂 Возраст: {profile['age']} лет
📏 Рост: {profile['height']} см
⚖️ Текущий вес: {profile['current_weight']} кг
🎯 Целевой вес: {profile['target_weight']} кг
💪 Активность: {activity_names.get(profile['activity_level'], profile['activity_level'])}
🎯 Цель: {goal_names.get(profile['goal'], profile['goal'])}
"""
        
        await query.edit_message_text(
            text=message,
            reply_markup=InlineKeyboards.profile_actions()
        )

async def edit_profile_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Начать редактирование профиля"""
    query = update.callback_query
    await query.answer()
    
    message = """✏️ РЕДАКТИРОВАНИЕ ПРОФИЛЯ

Укажи свой возраст (в годах):"""
    
    context.user_data['state'] = BotState.PROFILE_AGE
    context.user_data['editing_profile'] = True
    
    await query.edit_message_text(text=message)

async def update_weight_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обновить текущий вес"""
    query = update.callback_query
    await query.answer()
    
    message = """⚖️ ОБНОВЛЕНИЕ ВЕСА

Введи свой текущий вес (в кг):"""
    
    context.user_data['state'] = BotState.PROFILE_CURRENT_WEIGHT
    context.user_data['quick_weight_update'] = True
    
    await query.edit_message_text(text=message)

# Обработчики текстовых ответов для создания профиля
async def handle_profile_age(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка возраста"""
    valid, age, error = DataValidator.validate_age(update.message.text)
    
    if not valid:
        await update.message.reply_text(f"❌ {error}\n\nПопробуй еще раз:")
        return
    
    context.user_data['profile_data'] = {'age': age}
    context.user_data['state'] = BotState.PROFILE_GENDER
    
    await update.message.reply_text(
        "👤 Укажи свой пол:",
        reply_markup=InlineKeyboards.gender_selection()
    )

async def handle_gender_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка выбора пола"""
    query = update.callback_query
    await query.answer()
    
    gender = query.data.split('_')[1]  # gender_male -> male
    context.user_data['profile_data']['gender'] = gender
    context.user_data['state'] = BotState.PROFILE_HEIGHT
    
    await query.edit_message_text("📏 Укажи свой рост (в сантиметрах):")

async def handle_profile_height(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка роста"""
    valid, height, error = DataValidator.validate_height(update.message.text)
    
    if not valid:
        await update.message.reply_text(f"❌ {error}\n\nПопробуй еще раз:")
        return
    
    context.user_data['profile_data']['height'] = height
    context.user_data['state'] = BotState.PROFILE_CURRENT_WEIGHT
    
    await update.message.reply_text("⚖️ Укажи свой текущий вес (в килограммах):")

async def handle_profile_current_weight(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка текущего веса"""
    valid, weight, error = DataValidator.validate_weight(update.message.text)
    
    if not valid:
        await update.message.reply_text(f"❌ {error}\n\nПопробуй еще раз:")
        return
    
    # Проверяем, это быстрое обновление веса или полное создание профиля
    if context.user_data.get('quick_weight_update'):
        db = context.bot_data['db']
        user_id = context.user_data['user_id']
        
        await db.update_user_profile(user_id, {'current_weight': weight})
        
        context.user_data['state'] = BotState.IDLE
        context.user_data.pop('quick_weight_update', None)
        
        await update.message.reply_text(
            f"✅ Вес обновлен: {weight} кг",
            reply_markup=InlineKeyboards.back_to_menu()
        )
        return
    
    context.user_data['profile_data']['current_weight'] = weight
    context.user_data['state'] = BotState.PROFILE_TARGET_WEIGHT
    
    await update.message.reply_text("🎯 Укажи свой целевой вес (в килограммах):")

async def handle_profile_target_weight(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка целевого веса"""
    valid, weight, error = DataValidator.validate_weight(update.message.text)
    
    if not valid:
        await update.message.reply_text(f"❌ {error}\n\nПопробуй еще раз:")
        return
    
    context.user_data['profile_data']['target_weight'] = weight
    context.user_data['state'] = BotState.PROFILE_ACTIVITY
    
    await update.message.reply_text(
        "💪 Выбери уровень своей физической активности:",
        reply_markup=InlineKeyboards.activity_level()
    )

async def handle_activity_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка выбора активности"""
    query = update.callback_query
    await query.answer()
    
    activity = query.data.split('_')[1]  # activity_moderate -> moderate
    context.user_data['profile_data']['activity_level'] = activity
    context.user_data['state'] = BotState.PROFILE_GOAL
    
    await query.edit_message_text(
        "🎯 Какая у тебя цель?",
        reply_markup=InlineKeyboards.goal_selection()
    )

async def handle_goal_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка выбора цели"""
    query = update.callback_query
    await query.answer()
    
    goal = query.data.split('_')[1]  # goal_lose -> lose
    context.user_data['profile_data']['goal'] = goal
    context.user_data['state'] = BotState.PROFILE_METHOD
    
    await query.edit_message_text(
        "🔬 Выбери метод расчета КБЖУ:",
        reply_markup=InlineKeyboards.calculation_method()
    )

async def handle_method_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка выбора метода и создание профиля + плана"""
    query = update.callback_query
    await query.answer()
    
    method = query.data.split('_')[1]  # method_mifflin -> mifflin
    context.user_data['profile_data']['calculation_method'] = method
    
    # Сохраняем профиль в БД
    db = context.bot_data['db']
    user_id = context.user_data['user_id']
    profile_data = context.user_data['profile_data']
    profile_data['user_id'] = user_id
    
    await query.edit_message_text("⏳ Создаю твой профиль и рассчитываю план питания...")
    
    try:
        # Создаем или обновляем профиль
        if context.user_data.get('editing_profile'):
            await db.update_user_profile(user_id, profile_data)
        else:
            await db.create_user_profile(profile_data)
        
        # Генерируем план питания через AI
        openai_service = context.bot_data['openai']
        
        plan = await openai_service.generate_nutrition_plan(
            age=profile_data['age'],
            gender=profile_data['gender'],
            height=profile_data['height'],
            current_weight=profile_data['current_weight'],
            target_weight=profile_data['target_weight'],
            activity_level=profile_data['activity_level'],
            goal=profile_data['goal'],
            method=method
        )
        
        # Создаем базовое объяснение методики
        methodology_explanation = NutritionCalculator.get_methodology_explanation(
            method=method,
            goal=profile_data['goal'],
            activity_level=profile_data['activity_level'],
            bmr=plan['bmr'],
            tdee=plan['tdee'],
            target_calories=plan['target_calories']
        )
        
        # Добавляем объяснение от AI
        if 'explanation' in plan:
            methodology_explanation += f"\n\n💡 {plan['explanation']}"
        
        # Сохраняем план в БД
        nutrition_plan_data = {
            'user_id': user_id,
            'calories': plan['target_calories'],
            'protein': plan['protein_grams'],
            'fats': plan['fats_grams'],
            'carbs': plan['carbs_grams'],
            'bmr': plan['bmr'],
            'tdee': plan['tdee'],
            'methodology_explanation': methodology_explanation
        }
        
        await db.create_nutrition_plan(nutrition_plan_data)
        
        # Показываем результат
        result_message = f"""✅ ПРОФИЛЬ СОЗДАН!

🎯 ТВОЙ ПЛАН ПИТАНИЯ:

📊 Калории: {plan['target_calories']} ккал/день
🥩 Белки: {plan['protein_grams']} г
🥑 Жиры: {plan['fats_grams']} г
🍞 Углеводы: {plan['carbs_grams']} г

{methodology_explanation}

Теперь ты можешь начать отслеживать свое питание! 🎉"""
        
        context.user_data['state'] = BotState.IDLE
        context.user_data.pop('profile_data', None)
        context.user_data.pop('editing_profile', None)
        
        await query.edit_message_text(
            text=result_message,
            reply_markup=InlineKeyboards.main_menu()
        )
        
    except Exception as e:
        logger.error(f"Ошибка создания профиля: {e}")
        await query.edit_message_text(
            "❌ Произошла ошибка при создании профиля. Попробуй еще раз.",
            reply_markup=InlineKeyboards.back_to_menu()
        )

