"""
Сервис для работы с голосовыми сообщениями
"""
import logging
import os
import requests
from openai import OpenAI
from typing import Optional

logger = logging.getLogger(__name__)

class VoiceService:
    """Сервис для обработки голосовых сообщений"""
    
    def __init__(self, openai_api_key: str):
        """Инициализация сервиса"""
        self.openai_client = OpenAI(api_key=openai_api_key)
        logger.info("Voice сервис инициализирован")
    
    async def download_voice_file(self, file_url: str, file_path: str, bot_token: str) -> bool:
        """
        Скачать голосовой файл из Telegram
        """
        try:
            url = f"https://api.telegram.org/file/bot{bot_token}/{file_url}"
            response = requests.get(url)
            
            if response.status_code == 200:
                # Создаем директорию если её нет
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                
                with open(file_path, 'wb') as f:
                    f.write(response.content)
                logger.info(f"Голосовой файл скачан: {file_path}")
                return True
            else:
                logger.error(f"Ошибка скачивания файла: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Ошибка скачивания голосового файла: {e}")
            return False
    
    async def transcribe_voice(self, audio_file_path: str) -> Optional[str]:
        """
        Транскрибация голосового сообщения в текст через Whisper API
        """
        try:
            with open(audio_file_path, 'rb') as audio_file:
                transcript = self.openai_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language="ru"
                )
            
            logger.info(f"Транскрипция успешна: {transcript.text[:50]}...")
            
            # Удаляем временный файл
            try:
                os.remove(audio_file_path)
            except:
                pass
            
            return transcript.text
            
        except Exception as e:
            logger.error(f"Ошибка транскрибации: {e}")
            return None

