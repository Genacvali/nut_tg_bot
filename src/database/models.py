"""
Модели данных для работы с базой данных
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict

@dataclass
class User:
    """Модель пользователя"""
    id: int
    telegram_id: int
    username: Optional[str]
    first_name: Optional[str]
    created_at: datetime
    updated_at: datetime

@dataclass
class UserProfile:
    """Профиль пользователя с физическими параметрами"""
    id: int
    user_id: int
    age: int
    gender: str  # male/female
    height: float  # см
    current_weight: float  # кг
    target_weight: float  # кг
    activity_level: str  # sedentary, light, moderate, active, very_active
    goal: str  # lose, maintain, gain
    calculation_method: str  # mifflin, harris
    created_at: datetime
    updated_at: datetime

@dataclass
class NutritionPlan:
    """План питания КБЖУ"""
    id: int
    user_id: int
    calories: int
    protein: float  # грамм
    fats: float  # грамм
    carbs: float  # грамм
    bmr: float  # Базовый метаболизм
    tdee: float  # Общий расход калорий
    methodology_explanation: str  # Объяснение расчета
    is_active: bool
    created_at: datetime
    updated_at: datetime

@dataclass
class FoodLog:
    """Запись о приеме пищи"""
    id: int
    user_id: int
    meal_type: str  # breakfast, lunch, dinner, snack
    description: str
    calories: Optional[float]
    protein: Optional[float]
    fats: Optional[float]
    carbs: Optional[float]
    logged_at: datetime
    created_at: datetime

@dataclass
class MealPlan:
    """План приема пищи (рекомендации)"""
    id: int
    user_id: int
    meal_description: str
    ingredients: str
    calories: float
    protein: float
    fats: float
    carbs: float
    created_by_ai: bool
    created_at: datetime

