"""
Сервис для работы с OpenAI API
"""
from openai import OpenAI
from typing import List, Dict, Optional
import logging
import json

logger = logging.getLogger(__name__)

class OpenAIService:
    """Сервис для работы с OpenAI ChatGPT"""
    
    def __init__(self, api_key: str):
        """Инициализация клиента OpenAI"""
        self.client = OpenAI(api_key=api_key)
        self.model = "gpt-4o-mini"  # Используем более экономичную модель
        logger.info("OpenAI клиент инициализирован")
    
    async def generate_nutrition_plan(
        self, 
        age: int, 
        gender: str, 
        height: float, 
        current_weight: float,
        target_weight: float,
        activity_level: str,
        goal: str,
        method: str = "mifflin"
    ) -> Dict:
        """
        Генерация плана КБЖУ с объяснением методики через AI
        """
        prompt = f"""Ты - профессиональный диетолог. Рассчитай КБЖУ для клиента и объясни методику.

Данные клиента:
- Возраст: {age} лет
- Пол: {"мужской" if gender == "male" else "женский"}
- Рост: {height} см
- Текущий вес: {current_weight} кг
- Целевой вес: {target_weight} кг
- Уровень активности: {activity_level}
- Цель: {goal}
- Метод расчета: {method}

Выполни следующее:
1. Рассчитай базовый метаболизм (BMR) используя формулу {method}
2. Рассчитай общий расход калорий (TDEE) с учетом активности
3. Определи целевую калорийность в зависимости от цели
4. Рассчитай оптимальное распределение БЖУ
5. Подробно объясни, почему выбраны именно эти значения

Верни результат СТРОГО в формате JSON:
{{
    "bmr": число,
    "tdee": число,
    "target_calories": число,
    "protein_grams": число,
    "fats_grams": число,
    "carbs_grams": число,
    "explanation": "подробное объяснение расчетов и методики"
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "Ты опытный диетолог и нутрициолог. Всегда отвечай на русском языке в формате JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            logger.info(f"План КБЖУ успешно сгенерирован для параметров: {gender}, {age} лет")
            return result
            
        except Exception as e:
            logger.error(f"Ошибка генерации плана КБЖУ: {e}")
            raise
    
    async def adjust_nutrition_plan(
        self,
        current_plan: Dict,
        user_request: str,
        user_data: Dict
    ) -> Dict:
        """
        Корректировка плана КБЖУ на основе запроса пользователя
        """
        prompt = f"""Ты - профессиональный диетолог. Клиент хочет скорректировать свой план питания.

Текущий план:
- Калории: {current_plan['calories']} ккал
- Белки: {current_plan['protein']} г
- Жиры: {current_plan['fats']} г
- Углеводы: {current_plan['carbs']} г

Запрос клиента: "{user_request}"

Данные клиента: {json.dumps(user_data, ensure_ascii=False)}

Скорректируй план с учетом пожеланий клиента, но обязательно объясни:
1. Какие изменения ты вносишь
2. Почему эти изменения безопасны и эффективны
3. Какие могут быть последствия

Верни результат в формате JSON:
{{
    "target_calories": число,
    "protein_grams": число,
    "fats_grams": число,
    "carbs_grams": число,
    "adjustment_explanation": "объяснение корректировок"
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "Ты опытный диетолог. Помогаешь корректировать планы питания безопасно и эффективно."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                response_format={"type": "json_object"}
            )
            
            return json.loads(response.choices[0].message.content)
            
        except Exception as e:
            logger.error(f"Ошибка корректировки плана: {e}")
            raise
    
    async def analyze_food(self, food_description: str) -> Dict:
        """
        Анализ еды и расчет КБЖУ по описанию
        """
        prompt = f"""Ты - эксперт по питанию. Проанализируй описание еды и оцени примерное содержание КБЖУ.

Описание: "{food_description}"

Оцени примерное содержание калорий, белков, жиров и углеводов.
Если описание недостаточно подробное, сделай разумные предположения на основе типичных порций.

Верни результат в формате JSON:
{{
    "food_name": "название блюда",
    "calories": число,
    "protein": число,
    "fats": число,
    "carbs": число,
    "portion_note": "примечание о размере порции"
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "Ты эксперт-нутрициолог. Анализируешь еду и оцениваешь КБЖУ."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                response_format={"type": "json_object"}
            )
            
            return json.loads(response.choices[0].message.content)
            
        except Exception as e:
            logger.error(f"Ошибка анализа еды: {e}")
            raise
    
    async def suggest_meal(
        self,
        user_request: str,
        nutrition_plan: Dict,
        daily_consumed: Dict
    ) -> Dict:
        """
        Предложение блюда на основе запроса и остатка дневной нормы КБЖУ
        """
        remaining = {
            "calories": nutrition_plan["calories"] - daily_consumed.get("calories", 0),
            "protein": nutrition_plan["protein"] - daily_consumed.get("protein", 0),
            "fats": nutrition_plan["fats"] - daily_consumed.get("fats", 0),
            "carbs": nutrition_plan["carbs"] - daily_consumed.get("carbs", 0)
        }
        
        prompt = f"""Ты - персональный шеф-повар и диетолог. Предложи блюдо клиенту.

Запрос клиента: "{user_request}"

Дневная норма КБЖУ:
- Калории: {nutrition_plan['calories']} ккал
- Белки: {nutrition_plan['protein']} г
- Жиры: {nutrition_plan['fats']} г
- Углеводы: {nutrition_plan['carbs']} г

Уже употреблено сегодня:
- Калории: {daily_consumed.get('calories', 0)} ккал
- Белки: {daily_consumed.get('protein', 0)} г
- Жиры: {daily_consumed.get('fats', 0)} г
- Углеводы: {daily_consumed.get('carbs', 0)} г

Осталось до нормы:
- Калории: {remaining['calories']} ккал
- Белки: {remaining['protein']} г
- Жиры: {remaining['fats']} г
- Углеводы: {remaining['carbs']} г

Предложи блюдо или рецепт, которое:
1. Подходит под запрос клиента
2. Вписывается в оставшуюся норму КБЖУ
3. Вкусное и легкое в приготовлении

Верни результат в формате JSON:
{{
    "meal_name": "название блюда",
    "description": "краткое описание",
    "ingredients": "список ингредиентов",
    "cooking_instructions": "краткая инструкция по приготовлению",
    "calories": число,
    "protein": число,
    "fats": число,
    "carbs": число,
    "fits_plan": true/false,
    "recommendation_note": "примечание/рекомендация"
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "Ты персональный шеф-повар и диетолог. Предлагаешь вкусные и здоровые блюда."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.8,
                response_format={"type": "json_object"}
            )
            
            return json.loads(response.choices[0].message.content)
            
        except Exception as e:
            logger.error(f"Ошибка предложения блюда: {e}")
            raise
    
    async def general_chat(self, user_message: str, context: Optional[List[Dict]] = None) -> str:
        """
        Общение с AI ассистентом
        """
        messages = [
            {"role": "system", "content": "Ты персональный AI-ассистент по питанию и здоровому образу жизни. Помогаешь людям достигать их целей по питанию."}
        ]
        
        if context:
            messages.extend(context)
        
        messages.append({"role": "user", "content": user_message})
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.8,
                max_tokens=1000
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"Ошибка общения с AI: {e}")
            raise

