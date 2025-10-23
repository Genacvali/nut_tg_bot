"""
Конфигурация приложения
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Supabase настройки
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Настройки по умолчанию
DEFAULT_ACTIVITY_LEVELS = {
    "sedentary": 1.2,  # Сидячий образ жизни
    "light": 1.375,    # Легкая активность (1-3 раза в неделю)
    "moderate": 1.55,  # Умеренная активность (3-5 раз в неделю)
    "active": 1.725,   # Высокая активность (6-7 раз в неделю)
    "very_active": 1.9 # Очень высокая активность (2 раза в день)
}

# Цели
GOALS = {
    "lose": "Похудение",
    "maintain": "Поддержание веса",
    "gain": "Набор массы"
}

# Методики расчета
CALCULATION_METHODS = {
    "mifflin": "Формула Миффлина-Сан Жеора",
    "harris": "Формула Харриса-Бенедикта"
}

