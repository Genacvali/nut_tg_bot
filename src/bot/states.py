"""
Состояния для FSM (Finite State Machine) бота
"""
from enum import Enum

class BotState(str, Enum):
    """Состояния бота"""
    # Основные состояния
    IDLE = "idle"
    
    # Состояния создания профиля
    PROFILE_AGE = "profile_age"
    PROFILE_GENDER = "profile_gender"
    PROFILE_HEIGHT = "profile_height"
    PROFILE_CURRENT_WEIGHT = "profile_current_weight"
    PROFILE_TARGET_WEIGHT = "profile_target_weight"
    PROFILE_ACTIVITY = "profile_activity"
    PROFILE_GOAL = "profile_goal"
    PROFILE_METHOD = "profile_method"
    
    # Состояния корректировки КБЖУ
    ADJUST_NUTRITION = "adjust_nutrition"
    ADJUST_WAITING = "adjust_waiting"
    
    # Состояния логирования еды
    FOOD_LOG_WAITING = "food_log_waiting"
    FOOD_LOG_CONFIRM = "food_log_confirm"
    
    # Состояния планирования питания
    MEAL_PLAN_REQUEST = "meal_plan_request"
    
    # Состояние общения с AI
    AI_CHAT = "ai_chat"

