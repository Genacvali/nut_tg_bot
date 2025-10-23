"""
Сервис для работы с Supabase
"""
from supabase import create_client, Client
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class SupabaseService:
    """Сервис для работы с Supabase"""
    
    def __init__(self, url: str, key: str):
        """Инициализация клиента Supabase"""
        self.client: Client = create_client(url, key)
        logger.info("Supabase клиент инициализирован")
    
    def get_secret(self, secret_name: str) -> Optional[str]:
        """
        Получить секрет из Supabase
        В Supabase Dashboard -> Settings -> Vault можно хранить секреты
        Для работы с ними нужно использовать Supabase Functions или Edge Functions
        
        Для простоты, мы будем хранить секреты в переменных окружения,
        но можно настроить получение через API
        """
        try:
            # Примерный запрос к vault (требует настройки Edge Function)
            # result = self.client.rpc('get_secret', {'secret_name': secret_name}).execute()
            # return result.data
            
            # Временное решение - через переменные окружения или таблицу настроек
            result = self.client.table("app_settings").select("value").eq("key", secret_name).execute()
            if result.data:
                return result.data[0]["value"]
            return None
        except Exception as e:
            logger.error(f"Ошибка получения секрета {secret_name}: {e}")
            return None
    
    def get_client(self) -> Client:
        """Получить клиент Supabase"""
        return self.client

