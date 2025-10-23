// Telegram UX компоненты для нового интерфейса
// Инлайн-меню, потоки и навигация без команд

// Типы для типизации
interface InlineKeyboard {
  inline_keyboard: Array<Array<{
    text: string;
    callback_data: string;
  }>>;
}

interface UserState {
  last_menu?: string;
  onboarding_step?: string;
  editing_meal_id?: number;
  temp_goals?: any;
}

// Главное меню (инлайн-кнопки)
export function getMainMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '👤 Профиль', callback_data: 'menu_profile' },
        { text: '📊 Рассчитать КБЖУ', callback_data: 'menu_calculate' }
      ],
      [
        { text: '⚙️ Настроить макросы', callback_data: 'menu_macros' },
        { text: '📅 Сегодня', callback_data: 'menu_today' }
      ],
      [
        { text: '⏰ Напоминания', callback_data: 'menu_reminders' },
        { text: '❓ Помощь', callback_data: 'menu_help' }
      ]
    ]
  };
}

// Меню профиля
export function getProfileMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '📏 Параметры', callback_data: 'profile_params' },
        { text: '🎯 Цели', callback_data: 'profile_goals' }
      ],
      [
        { text: '🍽️ Предпочтения', callback_data: 'profile_preferences' },
        { text: '📊 Статистика', callback_data: 'profile_stats' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_main' }
      ]
    ]
  };
}

// Меню расчета КБЖУ
export function getCalculateMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Пересчитать', callback_data: 'calc_recalculate' },
        { text: '📋 Показать план', callback_data: 'calc_show_plan' }
      ],
      [
        { text: '✅ Принять план', callback_data: 'calc_accept' },
        { text: '⚙️ Настроить', callback_data: 'calc_adjust' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_main' }
      ]
    ]
  };
}

// Меню настройки макросов
export function getMacrosMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🥩 Высокобелковый', callback_data: 'macro_hi_protein' },
        { text: '🥗 Низкоуглеводный', callback_data: 'macro_low_carb' }
      ],
      [
        { text: '🥑 Кето', callback_data: 'macro_keto' },
        { text: '✏️ Ручная настройка', callback_data: 'macro_manual' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_main' }
      ]
    ]
  };
}

// Меню "Сегодня"
export function getTodayMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить приём', callback_data: 'today_add_meal' },
        { text: '📊 Итог дня', callback_data: 'today_summary' }
      ],
      [
        { text: '📝 История', callback_data: 'today_history' },
        { text: '🗑️ Очистить день', callback_data: 'today_clear' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_main' }
      ]
    ]
  };
}

// Меню напоминаний
export function getRemindersMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '📊 Отчёт дня', callback_data: 'reminder_day_report' },
        { text: '🍽️ Приём пищи', callback_data: 'reminder_meal' }
      ],
      [
        { text: '⚖️ Взвешивание', callback_data: 'reminder_weigh' },
        { text: '⚙️ Настройки', callback_data: 'reminder_settings' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_main' }
      ]
    ]
  };
}

// Клавиатура для выбора типа приёма пищи
export function getMealTypeKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🌅 Завтрак', callback_data: 'meal_type_breakfast' },
        { text: '☀️ Обед', callback_data: 'meal_type_lunch' }
      ],
      [
        { text: '🌆 Ужин', callback_data: 'meal_type_dinner' },
        { text: '🍎 Перекус', callback_data: 'meal_type_snack' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_today' }
      ]
    ]
  };
}

// Клавиатура для подтверждения плана
export function getPlanConfirmationKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅ Принять', callback_data: 'plan_accept' },
        { text: '⚙️ Настроить', callback_data: 'plan_adjust' }
      ],
      [
        { text: '🔄 Пересчитать', callback_data: 'plan_recalculate' }
      ]
    ]
  };
}

// Клавиатура для настройки времени напоминаний
export function getTimeSelectionKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '07:00', callback_data: 'time_07:00' },
        { text: '08:00', callback_data: 'time_08:00' },
        { text: '09:00', callback_data: 'time_09:00' }
      ],
      [
        { text: '12:00', callback_data: 'time_12:00' },
        { text: '13:00', callback_data: 'time_13:00' },
        { text: '14:00', callback_data: 'time_14:00' }
      ],
      [
        { text: '18:00', callback_data: 'time_18:00' },
        { text: '19:00', callback_data: 'time_19:00' },
        { text: '20:00', callback_data: 'time_20:00' }
      ],
      [
        { text: '21:00', callback_data: 'time_21:00' },
        { text: '22:00', callback_data: 'time_22:00' }
      ],
      [
        { text: '↩️ Назад', callback_data: 'menu_reminders' }
      ]
    ]
  };
}

// Сообщения для разных меню

export function getMainMenuMessage(): string {
  return `🍎 Главное меню

Выберите действие:`;
}

export function getProfileMenuMessage(): string {
  return `👤 Профиль

Управление вашими данными:`;
}

export function getCalculateMenuMessage(): string {
  return `📊 Расчёт КБЖУ

Рассчитайте персональный план питания:`;
}

export function getMacrosMenuMessage(): string {
  return `⚙️ Настройка макросов

Выберите тип диеты или настройте вручную:`;
}

export function getTodayMenuMessage(): string {
  return `📅 Сегодня

Управление дневным рационом:`;
}

export function getRemindersMenuMessage(): string {
  return `⏰ Напоминания

Настройте уведомления:`;
}

// Потоки онбординга

export function getOnboardingStepMessage(step: string, userData?: any): string {
  switch (step) {
    case 'age':
      return `👋 Добро пожаловать!

Для составления персонального плана мне нужны ваши данные.

📅 Сколько вам лет?`;
      
    case 'sex':
      return `👤 Укажите ваш пол:

• Мужской
• Женский`;
      
    case 'height':
      return `📏 Какой у вас рост в сантиметрах?

Например: 175`;
      
    case 'weight':
      return `⚖️ Какой у вас текущий вес в килограммах?

Например: 70`;
      
    case 'activity':
      return `🏃‍♂️ Какой у вас уровень активности?

• Малоподвижный (офисная работа)
• Лёгкая активность (1-3 тренировки/неделя)
• Умеренная активность (3-5 тренировок/неделя)
• Высокая активность (6-7 тренировок/неделя)
• Очень высокая активность (2+ тренировки/день)`;
      
    case 'goal':
      return `🎯 Какую цель вы преследуете?

• Похудение (сбросить вес)
• Поддержание веса
• Набор массы`;
      
    case 'confirmation':
      return `✅ Проверьте ваши данные:

👤 Возраст: ${userData?.age} лет
👤 Пол: ${userData?.sex === 'male' ? 'Мужской' : 'Женский'}
📏 Рост: ${userData?.height_cm} см
⚖️ Вес: ${userData?.weight_kg} кг
🏃‍♂️ Активность: ${userData?.activity}
🎯 Цель: ${userData?.goal}

Всё верно?`;
      
    default:
      return 'Неизвестный шаг онбординга';
  }
}

// Обработчики callback_query

export function handleCallbackQuery(callbackData: string, userId: number, chatId: number) {
  // Главное меню
  if (callbackData === 'menu_main') {
    return {
      message: getMainMenuMessage(),
      keyboard: getMainMenuKeyboard()
    };
  }
  
  // Профиль
  if (callbackData === 'menu_profile') {
    return {
      message: getProfileMenuMessage(),
      keyboard: getProfileMenuKeyboard()
    };
  }
  
  // Расчёт КБЖУ
  if (callbackData === 'menu_calculate') {
    return {
      message: getCalculateMenuMessage(),
      keyboard: getCalculateMenuKeyboard()
    };
  }
  
  // Настройка макросов
  if (callbackData === 'menu_macros') {
    return {
      message: getMacrosMenuMessage(),
      keyboard: getMacrosMenuKeyboard()
    };
  }
  
  // Сегодня
  if (callbackData === 'menu_today') {
    return {
      message: getTodayMenuMessage(),
      keyboard: getTodayMenuKeyboard()
    };
  }
  
  // Напоминания
  if (callbackData === 'menu_reminders') {
    return {
      message: getRemindersMenuMessage(),
      keyboard: getRemindersMenuKeyboard()
    };
  }
  
  // Добавление приёма пищи
  if (callbackData === 'today_add_meal') {
    return {
      message: '🍽️ Выберите тип приёма пищи:',
      keyboard: getMealTypeKeyboard()
    };
  }
  
  // Выбор времени для напоминаний
  if (callbackData.startsWith('time_')) {
    const time = callbackData.replace('time_', '');
    return {
      message: `⏰ Напоминание установлено на ${time}`,
      keyboard: getRemindersMenuKeyboard()
    };
  }
  
  // Обработка типов приёмов пищи
  if (callbackData.startsWith('meal_type_')) {
    const mealType = callbackData.replace('meal_type_', '');
    const mealTypeNames = {
      breakfast: 'завтрак',
      lunch: 'обед',
      dinner: 'ужин',
      snack: 'перекус'
    };
    
    return {
      message: `🍽️ Добавление ${mealTypeNames[mealType as keyof typeof mealTypeNames]}

Опишите что вы ели или отправьте фото:`,
      keyboard: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_today' }]] }
    };
  }
  
  // Макросы - пресеты
  if (callbackData === 'macro_hi_protein') {
    return {
      message: '🥩 Высокобелковая диета\n\nБелки: +20%\nЖиры: -10%\nУглеводы: -10%',
      keyboard: getMacrosMenuKeyboard()
    };
  }
  
  if (callbackData === 'macro_low_carb') {
    return {
      message: '🥗 Низкоуглеводная диета\n\nБелки: +15%\nЖиры: +15%\nУглеводы: -30%',
      keyboard: getMacrosMenuKeyboard()
    };
  }
  
  if (callbackData === 'macro_keto') {
    return {
      message: '🥑 Кето диета\n\nБелки: 20%\nЖиры: 70%\nУглеводы: 10%',
      keyboard: getMacrosMenuKeyboard()
    };
  }
  
  // Помощь
  if (callbackData === 'menu_help') {
    return {
      message: `❓ Помощь

🍎 Этот бот поможет вам:
• Отслеживать КБЖУ
• Составлять планы питания
• Получать персональные советы

📝 Как пользоваться:
• Отправляйте описание еды текстом
• Фотографируйте блюда
• Используйте голосовые сообщения
• Настраивайте напоминания

🎯 Главное меню всегда доступно!`,
      keyboard: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_main' }]] }
    };
  }
  
  // По умолчанию возвращаем главное меню
  return {
    message: getMainMenuMessage(),
    keyboard: getMainMenuKeyboard()
  };
}

// Функция для обновления состояния пользователя
export function updateUserState(userId: number, state: Partial<UserState>) {
  // Здесь будет логика обновления состояния в БД
  console.log(`Updating state for user ${userId}:`, state);
}

// Функция для получения состояния пользователя
export function getUserState(userId: number): UserState {
  // Здесь будет логика получения состояния из БД
  return {};
}

export default {
  getMainMenuKeyboard,
  getProfileMenuKeyboard,
  getCalculateMenuKeyboard,
  getMacrosMenuKeyboard,
  getTodayMenuKeyboard,
  getRemindersMenuKeyboard,
  getMealTypeKeyboard,
  getPlanConfirmationKeyboard,
  getTimeSelectionKeyboard,
  getMainMenuMessage,
  getProfileMenuMessage,
  getCalculateMenuMessage,
  getMacrosMenuMessage,
  getTodayMenuMessage,
  getRemindersMenuMessage,
  getOnboardingStepMessage,
  handleCallbackQuery,
  updateUserState,
  getUserState
};
