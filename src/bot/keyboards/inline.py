"""
Inline клавиатуры для навигации в боте
"""
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

class InlineKeyboards:
    """Класс для создания inline клавиатур"""
    
    @staticmethod
    def main_menu() -> InlineKeyboardMarkup:
        """Главное меню бота"""
        keyboard = [
            [
                InlineKeyboardButton("📊 Мой профиль", callback_data="profile"),
                InlineKeyboardButton("🎯 Мой план КБЖУ", callback_data="nutrition_plan")
            ],
            [
                InlineKeyboardButton("🍽 Записать еду", callback_data="log_food"),
                InlineKeyboardButton("📅 Сегодняшняя статистика", callback_data="today_stats")
            ],
            [
                InlineKeyboardButton("👨‍🍳 Что приготовить?", callback_data="meal_suggestions"),
                InlineKeyboardButton("💬 Спросить AI", callback_data="ai_chat")
            ],
            [
                InlineKeyboardButton("⚙️ Настройки", callback_data="settings"),
                InlineKeyboardButton("ℹ️ Помощь", callback_data="help")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def gender_selection() -> InlineKeyboardMarkup:
        """Выбор пола"""
        keyboard = [
            [
                InlineKeyboardButton("👨 Мужской", callback_data="gender_male"),
                InlineKeyboardButton("👩 Женский", callback_data="gender_female")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def activity_level() -> InlineKeyboardMarkup:
        """Выбор уровня активности"""
        keyboard = [
            [InlineKeyboardButton("🪑 Сидячий образ жизни", callback_data="activity_sedentary")],
            [InlineKeyboardButton("🚶 Легкая активность (1-3 раза/неделю)", callback_data="activity_light")],
            [InlineKeyboardButton("🏃 Умеренная активность (3-5 раз/неделю)", callback_data="activity_moderate")],
            [InlineKeyboardButton("💪 Высокая активность (6-7 раз/неделю)", callback_data="activity_active")],
            [InlineKeyboardButton("🔥 Очень высокая (2 раза/день)", callback_data="activity_very_active")]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def goal_selection() -> InlineKeyboardMarkup:
        """Выбор цели"""
        keyboard = [
            [InlineKeyboardButton("📉 Похудение", callback_data="goal_lose")],
            [InlineKeyboardButton("⚖️ Поддержание веса", callback_data="goal_maintain")],
            [InlineKeyboardButton("📈 Набор массы", callback_data="goal_gain")]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def calculation_method() -> InlineKeyboardMarkup:
        """Выбор метода расчета"""
        keyboard = [
            [InlineKeyboardButton("🔬 Миффлина-Сан Жеора (рекомендуется)", callback_data="method_mifflin")],
            [InlineKeyboardButton("📐 Харриса-Бенедикта", callback_data="method_harris")]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def nutrition_plan_actions() -> InlineKeyboardMarkup:
        """Действия с планом питания"""
        keyboard = [
            [
                InlineKeyboardButton("✏️ Скорректировать", callback_data="adjust_plan"),
                InlineKeyboardButton("🔄 Пересчитать", callback_data="recalculate_plan")
            ],
            [
                InlineKeyboardButton("📊 Статистика", callback_data="plan_stats"),
                InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def meal_type_selection() -> InlineKeyboardMarkup:
        """Выбор типа приема пищи"""
        keyboard = [
            [
                InlineKeyboardButton("🌅 Завтрак", callback_data="meal_breakfast"),
                InlineKeyboardButton("🌞 Обед", callback_data="meal_lunch")
            ],
            [
                InlineKeyboardButton("🌆 Ужин", callback_data="meal_dinner"),
                InlineKeyboardButton("🍎 Перекус", callback_data="meal_snack")
            ],
            [
                InlineKeyboardButton("🔙 Назад", callback_data="main_menu")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def food_log_confirm(food_data: dict) -> InlineKeyboardMarkup:
        """Подтверждение записи о еде"""
        keyboard = [
            [
                InlineKeyboardButton("✅ Подтвердить", callback_data=f"confirm_food_{food_data.get('id', 'temp')}"),
                InlineKeyboardButton("✏️ Изменить", callback_data="edit_food")
            ],
            [
                InlineKeyboardButton("❌ Отменить", callback_data="cancel_food")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def back_to_menu() -> InlineKeyboardMarkup:
        """Кнопка возврата в главное меню"""
        keyboard = [[InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")]]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def profile_actions() -> InlineKeyboardMarkup:
        """Действия с профилем"""
        keyboard = [
            [
                InlineKeyboardButton("✏️ Редактировать", callback_data="edit_profile"),
                InlineKeyboardButton("🔄 Обновить вес", callback_data="update_weight")
            ],
            [
                InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def today_stats_actions() -> InlineKeyboardMarkup:
        """Действия со статистикой"""
        keyboard = [
            [
                InlineKeyboardButton("🍽 Добавить еду", callback_data="log_food"),
                InlineKeyboardButton("📊 История", callback_data="food_history")
            ],
            [
                InlineKeyboardButton("🏠 Главное меню", callback_data="main_menu")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    @staticmethod
    def yes_no(action: str) -> InlineKeyboardMarkup:
        """Кнопки Да/Нет"""
        keyboard = [
            [
                InlineKeyboardButton("✅ Да", callback_data=f"yes_{action}"),
                InlineKeyboardButton("❌ Нет", callback_data=f"no_{action}")
            ]
        ]
        return InlineKeyboardMarkup(keyboard)

