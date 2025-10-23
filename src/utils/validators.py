"""
Валидаторы для проверки данных пользователя
"""
from typing import Tuple, Optional
import re

class DataValidator:
    """Валидация пользовательских данных"""
    
    @staticmethod
    def validate_age(age_str: str) -> Tuple[bool, Optional[int], str]:
        """Валидация возраста"""
        try:
            age = int(age_str)
            if 10 <= age <= 120:
                return True, age, ""
            else:
                return False, None, "Возраст должен быть от 10 до 120 лет"
        except ValueError:
            return False, None, "Пожалуйста, введите корректное число"
    
    @staticmethod
    def validate_weight(weight_str: str) -> Tuple[bool, Optional[float], str]:
        """Валидация веса"""
        try:
            weight = float(weight_str.replace(',', '.'))
            if 30 <= weight <= 300:
                return True, weight, ""
            else:
                return False, None, "Вес должен быть от 30 до 300 кг"
        except ValueError:
            return False, None, "Пожалуйста, введите корректное число"
    
    @staticmethod
    def validate_height(height_str: str) -> Tuple[bool, Optional[float], str]:
        """Валидация роста"""
        try:
            height = float(height_str.replace(',', '.'))
            if 100 <= height <= 250:
                return True, height, ""
            else:
                return False, None, "Рост должен быть от 100 до 250 см"
        except ValueError:
            return False, None, "Пожалуйста, введите корректное число"
    
    @staticmethod
    def validate_calories(calories_str: str) -> Tuple[bool, Optional[int], str]:
        """Валидация калорий"""
        try:
            calories = int(calories_str)
            if 500 <= calories <= 10000:
                return True, calories, ""
            else:
                return False, None, "Калорийность должна быть от 500 до 10000 ккал"
        except ValueError:
            return False, None, "Пожалуйста, введите корректное число"
    
    @staticmethod
    def validate_macros(macro_str: str) -> Tuple[bool, Optional[float], str]:
        """Валидация макронутриентов"""
        try:
            macro = float(macro_str.replace(',', '.'))
            if 0 <= macro <= 1000:
                return True, macro, ""
            else:
                return False, None, "Значение должно быть от 0 до 1000 грамм"
        except ValueError:
            return False, None, "Пожалуйста, введите корректное число"

