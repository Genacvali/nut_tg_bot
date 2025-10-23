"""
Калькуляторы КБЖУ и метаболизма
"""
from typing import Dict, Tuple
import logging

logger = logging.getLogger(__name__)

class NutritionCalculator:
    """Калькулятор для расчета КБЖУ"""
    
    @staticmethod
    def calculate_bmr_mifflin(weight: float, height: float, age: int, gender: str) -> float:
        """
        Расчет базового метаболизма по формуле Миффлина-Сан Жеора
        Самая точная на сегодняшний день формула
        
        Args:
            weight: вес в кг
            height: рост в см
            age: возраст в годах
            gender: пол ('male' или 'female')
        
        Returns:
            BMR в ккал/день
        """
        if gender == 'male':
            bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5
        else:  # female
            bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161
        
        logger.info(f"BMR (Mifflin): {bmr:.2f} ккал для {gender}, {age} лет, {weight} кг, {height} см")
        return round(bmr, 2)
    
    @staticmethod
    def calculate_bmr_harris(weight: float, height: float, age: int, gender: str) -> float:
        """
        Расчет базового метаболизма по формуле Харриса-Бенедикта (пересмотренная)
        
        Args:
            weight: вес в кг
            height: рост в см
            age: возраст в годах
            gender: пол ('male' или 'female')
        
        Returns:
            BMR в ккал/день
        """
        if gender == 'male':
            bmr = 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age)
        else:  # female
            bmr = 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age)
        
        logger.info(f"BMR (Harris-Benedict): {bmr:.2f} ккал для {gender}, {age} лет, {weight} кг, {height} см")
        return round(bmr, 2)
    
    @staticmethod
    def calculate_tdee(bmr: float, activity_level: str) -> float:
        """
        Расчет общего расхода энергии (TDEE) с учетом уровня активности
        
        Args:
            bmr: базовый метаболизм
            activity_level: уровень активности
        
        Returns:
            TDEE в ккал/день
        """
        activity_multipliers = {
            "sedentary": 1.2,      # Сидячий образ жизни
            "light": 1.375,        # Легкая активность (1-3 раза в неделю)
            "moderate": 1.55,      # Умеренная активность (3-5 раз в неделю)
            "active": 1.725,       # Высокая активность (6-7 раз в неделю)
            "very_active": 1.9     # Очень высокая активность (2 раза в день)
        }
        
        multiplier = activity_multipliers.get(activity_level, 1.2)
        tdee = bmr * multiplier
        
        logger.info(f"TDEE: {tdee:.2f} ккал (BMR: {bmr} * {multiplier})")
        return round(tdee, 2)
    
    @staticmethod
    def calculate_target_calories(tdee: float, goal: str) -> int:
        """
        Расчет целевой калорийности в зависимости от цели
        
        Args:
            tdee: общий расход энергии
            goal: цель ('lose', 'maintain', 'gain')
        
        Returns:
            Целевая калорийность в ккал/день
        """
        if goal == "lose":
            # Дефицит 15-20% для безопасного похудения
            target = tdee * 0.85
        elif goal == "gain":
            # Профицит 10-15% для набора массы
            target = tdee * 1.15
        else:  # maintain
            target = tdee
        
        logger.info(f"Целевая калорийность: {int(target)} ккал для цели '{goal}'")
        return int(target)
    
    @staticmethod
    def calculate_macros(target_calories: int, goal: str) -> Dict[str, float]:
        """
        Расчет макронутриентов (БЖУ) в граммах
        
        Args:
            target_calories: целевая калорийность
            goal: цель ('lose', 'maintain', 'gain')
        
        Returns:
            Словарь с количеством белков, жиров и углеводов в граммах
        """
        if goal == "lose":
            # Для похудения: больше белка, меньше углеводов
            protein_percent = 0.35  # 35%
            fat_percent = 0.25      # 25%
            carb_percent = 0.40     # 40%
        elif goal == "gain":
            # Для набора массы: сбалансированное соотношение
            protein_percent = 0.30  # 30%
            fat_percent = 0.25      # 25%
            carb_percent = 0.45     # 45%
        else:  # maintain
            # Для поддержания: классическое соотношение
            protein_percent = 0.30  # 30%
            fat_percent = 0.30      # 30%
            carb_percent = 0.40     # 40%
        
        # 1 грамм белка = 4 ккал
        # 1 грамм жира = 9 ккал
        # 1 грамм углеводов = 4 ккал
        
        protein_grams = round((target_calories * protein_percent) / 4, 1)
        fat_grams = round((target_calories * fat_percent) / 9, 1)
        carb_grams = round((target_calories * carb_percent) / 4, 1)
        
        macros = {
            "protein": protein_grams,
            "fats": fat_grams,
            "carbs": carb_grams
        }
        
        logger.info(f"Макронутриенты: Б:{protein_grams}г, Ж:{fat_grams}г, У:{carb_grams}г")
        return macros
    
    @staticmethod
    def calculate_full_nutrition_plan(
        weight: float,
        height: float,
        age: int,
        gender: str,
        activity_level: str,
        goal: str,
        method: str = "mifflin"
    ) -> Dict:
        """
        Полный расчет плана питания
        
        Returns:
            Словарь с полным планом питания и всеми расчетами
        """
        # Расчет BMR
        if method == "mifflin":
            bmr = NutritionCalculator.calculate_bmr_mifflin(weight, height, age, gender)
        else:  # harris
            bmr = NutritionCalculator.calculate_bmr_harris(weight, height, age, gender)
        
        # Расчет TDEE
        tdee = NutritionCalculator.calculate_tdee(bmr, activity_level)
        
        # Целевая калорийность
        target_calories = NutritionCalculator.calculate_target_calories(tdee, goal)
        
        # Макронутриенты
        macros = NutritionCalculator.calculate_macros(target_calories, goal)
        
        return {
            "bmr": bmr,
            "tdee": tdee,
            "target_calories": target_calories,
            "protein": macros["protein"],
            "fats": macros["fats"],
            "carbs": macros["carbs"]
        }
    
    @staticmethod
    def get_methodology_explanation(
        method: str,
        goal: str,
        activity_level: str,
        bmr: float,
        tdee: float,
        target_calories: int
    ) -> str:
        """
        Генерация объяснения методики расчета
        """
        method_name = "Миффлина-Сан Жеора" if method == "mifflin" else "Харриса-Бенедикта"
        
        activity_names = {
            "sedentary": "сидячий образ жизни (коэффициент 1.2)",
            "light": "легкая активность 1-3 раза в неделю (коэффициент 1.375)",
            "moderate": "умеренная активность 3-5 раз в неделю (коэффициент 1.55)",
            "active": "высокая активность 6-7 раз в неделю (коэффициент 1.725)",
            "very_active": "очень высокая активность, тренировки 2 раза в день (коэффициент 1.9)"
        }
        
        goal_names = {
            "lose": "похудение (дефицит 15%)",
            "maintain": "поддержание веса",
            "gain": "набор массы (профицит 15%)"
        }
        
        explanation = f"""📊 МЕТОДИКА РАСЧЕТА:

🔹 Базовый метаболизм (BMR): {bmr:.0f} ккал/день
   Рассчитан по формуле {method_name} - одной из самых точных современных формул.

🔹 Общий расход энергии (TDEE): {tdee:.0f} ккал/день
   BMR умножен на коэффициент активности ({activity_names.get(activity_level, activity_level)})

🔹 Целевая калорийность: {target_calories} ккал/день
   Скорректирована под вашу цель: {goal_names.get(goal, goal)}

🔹 Распределение макронутриентов:
   Оптимизировано для вашей цели с учетом эффективности усвоения и достижения результата."""
        
        return explanation

