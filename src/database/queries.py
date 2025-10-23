"""
SQL запросы и операции с базой данных
"""
from typing import Optional, List, Dict, Any
from datetime import datetime, date

class DatabaseQueries:
    """Класс для работы с запросами к базе данных"""
    
    def __init__(self, supabase_client):
        self.client = supabase_client
    
    # ===== USERS =====
    async def get_or_create_user(self, telegram_id: int, username: str = None, first_name: str = None) -> Dict:
        """Получить или создать пользователя"""
        result = self.client.table("users").select("*").eq("telegram_id", telegram_id).execute()
        
        if result.data:
            return result.data[0]
        
        user_data = {
            "telegram_id": telegram_id,
            "username": username,
            "first_name": first_name
        }
        result = self.client.table("users").insert(user_data).execute()
        return result.data[0]
    
    # ===== USER PROFILES =====
    async def get_user_profile(self, user_id: int) -> Optional[Dict]:
        """Получить профиль пользователя"""
        result = self.client.table("user_profiles").select("*").eq("user_id", user_id).execute()
        return result.data[0] if result.data else None
    
    async def create_user_profile(self, profile_data: Dict) -> Dict:
        """Создать профиль пользователя"""
        result = self.client.table("user_profiles").insert(profile_data).execute()
        return result.data[0]
    
    async def update_user_profile(self, user_id: int, profile_data: Dict) -> Dict:
        """Обновить профиль пользователя"""
        result = self.client.table("user_profiles").update(profile_data).eq("user_id", user_id).execute()
        return result.data[0]
    
    # ===== NUTRITION PLANS =====
    async def get_active_nutrition_plan(self, user_id: int) -> Optional[Dict]:
        """Получить активный план питания"""
        result = self.client.table("nutrition_plans").select("*").eq("user_id", user_id).eq("is_active", True).execute()
        return result.data[0] if result.data else None
    
    async def create_nutrition_plan(self, plan_data: Dict) -> Dict:
        """Создать план питания"""
        # Деактивируем все предыдущие планы
        self.client.table("nutrition_plans").update({"is_active": False}).eq("user_id", plan_data["user_id"]).execute()
        
        # Создаем новый активный план
        plan_data["is_active"] = True
        result = self.client.table("nutrition_plans").insert(plan_data).execute()
        return result.data[0]
    
    async def update_nutrition_plan(self, plan_id: int, plan_data: Dict) -> Dict:
        """Обновить план питания"""
        result = self.client.table("nutrition_plans").update(plan_data).eq("id", plan_id).execute()
        return result.data[0]
    
    # ===== FOOD LOGS =====
    async def create_food_log(self, log_data: Dict) -> Dict:
        """Создать запись о приеме пищи"""
        result = self.client.table("food_logs").insert(log_data).execute()
        return result.data[0]
    
    async def get_food_logs_by_date(self, user_id: int, date: date) -> List[Dict]:
        """Получить записи о еде за день"""
        start_datetime = datetime.combine(date, datetime.min.time())
        end_datetime = datetime.combine(date, datetime.max.time())
        
        result = self.client.table("food_logs").select("*")\
            .eq("user_id", user_id)\
            .gte("logged_at", start_datetime.isoformat())\
            .lte("logged_at", end_datetime.isoformat())\
            .order("logged_at", desc=False)\
            .execute()
        return result.data
    
    async def get_food_logs_summary(self, user_id: int, date: date) -> Dict:
        """Получить суммарную статистику за день"""
        logs = await self.get_food_logs_by_date(user_id, date)
        
        total = {
            "calories": 0,
            "protein": 0,
            "fats": 0,
            "carbs": 0,
            "count": len(logs)
        }
        
        for log in logs:
            total["calories"] += log.get("calories", 0) or 0
            total["protein"] += log.get("protein", 0) or 0
            total["fats"] += log.get("fats", 0) or 0
            total["carbs"] += log.get("carbs", 0) or 0
        
        return total
    
    # ===== MEAL PLANS =====
    async def create_meal_plan(self, meal_data: Dict) -> Dict:
        """Создать план приема пищи"""
        result = self.client.table("meal_plans").insert(meal_data).execute()
        return result.data[0]
    
    async def get_recent_meal_plans(self, user_id: int, limit: int = 10) -> List[Dict]:
        """Получить последние планы питания"""
        result = self.client.table("meal_plans").select("*")\
            .eq("user_id", user_id)\
            .order("created_at", desc=True)\
            .limit(limit)\
            .execute()
        return result.data

