// Шаблоны сообщений с правильным тоном (C.I.D.)
// Coach, Mentor, Neutral - три стиля общения

// Типы для типизации
type Tone = 'coach' | 'mentor' | 'neutral';

interface MessageTemplate {
  coach: string;
  mentor: string;
  neutral: string;
}

interface PlanCardData {
  tdee: number;
  targetCalories: number;
  protein: number;
  fat: number;
  carbs: number;
  goal: string;
}

interface DaySummaryData {
  calories: number;
  targetCalories: number;
  protein: number;
  targetProtein: number;
  fat: number;
  targetFat: number;
  carbs: number;
  targetCarbs: number;
  advice: string;
}

// Шаблоны сообщений

/**
 * Карточка плана питания
 */
export function getPlanCard(data: PlanCardData, tone: Tone): string {
  const templates: MessageTemplate = {
    coach: `💪 ВАШ ПЛАН ПИТАНИЯ

🔥 TDEE: ${data.tdee} ккал → цель ${data.goal} = ${data.targetCalories}
🥩 Белок: ${data.protein}г · 🥑 Жиры: ${data.fat}г · 🍞 Угли: ${data.carbs}г

[ Принять ]   [ Настроить ]

💪 Готовы к результатам? Давайте сделаем это!`,
    
    mentor: `🎯 ВАШ ПЛАН ПИТАНИЯ

📊 TDEE: ${data.tdee} ккал → цель ${data.goal} = ${data.targetCalories}
🥩 Белок: ${data.protein}г · 🥑 Жиры: ${data.fat}г · 🍞 Угли: ${data.carbs}г

[ Принять ]   [ Настроить ]

🎯 Этот план поможет достичь ваших целей.`,
    
    neutral: `📊 ВАШ ПЛАН ПИТАНИЯ

TDEE: ${data.tdee} ккал → цель ${data.goal} = ${data.targetCalories}
Белок: ${data.protein}г · Жиры: ${data.fat}г · Углеводы: ${data.carbs}г

[ Принять ]   [ Настроить ]

План рассчитан на основе ваших параметров.`
  };
  
  return templates[tone];
}

/**
 * Карточка итога дня
 */
export function getDaySummaryCard(data: DaySummaryData, tone: Tone): string {
  const caloriesProgress = Math.round((data.calories / data.targetCalories) * 100);
  const proteinProgress = Math.round((data.protein / data.targetProtein) * 100);
  const fatProgress = Math.round((data.fat / data.targetFat) * 100);
  const carbsProgress = Math.round((data.carbs / data.targetCarbs) * 100);
  
  const templates: MessageTemplate = {
    coach: `💪 ИТОГ ДНЯ

Сегодня: ${data.calories} / ${data.targetCalories} ккал
Б ${data.protein}/${data.targetProtein} · Ж ${data.fat}/${data.targetFat} · У ${data.carbs}/${data.targetCarbs}

💡 Совет: ${data.advice}

Продолжайте в том же духе!`,
    
    mentor: `📊 ИТОГ ДНЯ

Сегодня: ${data.calories} / ${data.targetCalories} ккал
Б ${data.protein}/${data.targetProtein} · Ж ${data.fat}/${data.targetFat} · У ${data.carbs}/${data.targetCarbs}

💡 Совет: ${data.advice}

Хорошая работа!`,
    
    neutral: `📊 ИТОГ ДНЯ

Сегодня: ${data.calories} / ${data.targetCalories} ккал
Б ${data.protein}/${data.targetProtein} · Ж ${data.fat}/${data.targetFat} · У ${data.carbs}/${data.targetCarbs}

Совет: ${data.advice}`
  };
  
  return templates[tone];
}

/**
 * Подтверждения действий
 */
export function getConfirmationMessage(action: string, tone: Tone): string {
  const templates: Record<string, MessageTemplate> = {
    profile_saved: {
      coach: '✅ Профиль сохранён! Готовы рассчитать план? 💪',
      mentor: '✅ Профиль сохранён. Готов рассчитать план?',
      neutral: '✅ Профиль сохранён. Готов рассчитать план?'
    },
    plan_updated: {
      coach: '⚙️ План обновлён! Белок +20г → Угли −80г. Продолжаем! 💪',
      mentor: '⚙️ План обновлён: Белок +20г → Углеводы −80г.',
      neutral: '⚙️ План обновлён: Белок +20г → Углеводы −80г.'
    },
    meal_added: {
      coach: '🍽️ Приём пищи добавлен! Отличный выбор! 💪',
      mentor: '🍽️ Приём пищи добавлен. Хороший выбор!',
      neutral: '🍽️ Приём пищи добавлен.'
    },
    reminder_set: {
      coach: '⏰ Напоминание установлено! Не забудем о целях! 💪',
      mentor: '⏰ Напоминание установлено. Поможет не забыть.',
      neutral: '⏰ Напоминание установлено.'
    }
  };
  
  return templates[action]?.[tone] || '✅ Действие выполнено.';
}

/**
 * Сообщения об ошибках (дружелюбно)
 */
export function getErrorMessage(error: string, tone: Tone): string {
  const templates: Record<string, MessageTemplate> = {
    save_error: {
      coach: '❌ Не смог сохранить! Попробуй ещё раз! 💪',
      mentor: '❌ Не смог сохранить, попробуй ещё раз.',
      neutral: '❌ Не смог сохранить, попробуй ещё раз.'
    },
    low_fat: {
      coach: '⚠️ Слишком низкий жир! Минимум 0.6 г/кг — исправил план! 💪',
      mentor: '⚠️ Слишком низкий жир. Минимум 0.6 г/кг — подправил план.',
      neutral: '⚠️ Слишком низкий жир. Минимум 0.6 г/кг — исправлено.'
    },
    low_protein: {
      coach: '⚠️ Мало белка! Минимум 1.4 г/кг — добавил в план! 💪',
      mentor: '⚠️ Мало белка. Минимум 1.4 г/кг — скорректировал план.',
      neutral: '⚠️ Мало белка. Минимум 1.4 г/кг — исправлено.'
    },
    voice_error: {
      coach: '🎤 Не смог распознать голос! Говори чётче! 💪',
      mentor: '🎤 Не смог распознать голос. Попробуй говорить чётче.',
      neutral: '🎤 Не смог распознать голос. Попробуй ещё раз.'
    },
    network_error: {
      coach: '🌐 Проблемы с сетью! Попробуй позже! 💪',
      mentor: '🌐 Проблемы с сетью. Попробуй позже.',
      neutral: '🌐 Проблемы с сетью. Попробуй позже.'
    }
  };
  
  return templates[error]?.[tone] || '❌ Произошла ошибка. Попробуй ещё раз.';
}

/**
 * Сообщения с кнопкой "Повторить"
 */
export function getRetryMessage(error: string, tone: Tone): { message: string; button: string } {
  const baseMessage = getErrorMessage(error, tone);
  
  const buttonTexts = {
    coach: '🔄 Повторить!',
    mentor: '🔄 Повторить',
    neutral: '🔄 Повторить'
  };
  
  return {
    message: baseMessage,
    button: buttonTexts[tone]
  };
}

/**
 * Приветственные сообщения
 */
export function getWelcomeMessage(tone: Tone, isNewUser: boolean = false): string {
  if (isNewUser) {
    const templates: MessageTemplate = {
      coach: `🍎 Добро пожаловать в AI бота-нутрициолога!

💪 Я твой персональный тренер по питанию!

🎯 ЧТО Я УМЕЮ:
• Анализирую еду из текста, фото и голоса
• Рассчитываю персональные нормы КБЖУ
• Составляю планы питания
• Отправляю ежедневные отчёты

🚀 Готов начать? Расскажи о себе!`,
      
      mentor: `🍎 Добро пожаловать в AI бота-нутрициолога!

🎯 Я ваш персональный помощник по питанию.

📊 ЧТО Я УМЕЮ:
• Анализирую еду из текста, фото и голоса
• Рассчитываю персональные нормы КБЖУ
• Составляю планы питания
• Отправляю ежедневные отчёты

Готов помочь вам достичь целей!`,
      
      neutral: `🍎 Добро пожаловать в AI бота-нутрициолога!

Я ваш помощник по питанию.

Функции:
• Анализ еды из текста, фото и голоса
• Расчёт персональных норм КБЖУ
• Составление планов питания
• Ежедневные отчёты

Начнём работу!`
    };
    
    return templates[tone];
  }
  
  // Возвращающийся пользователь
  const templates: MessageTemplate = {
    coach: '💪 С возвращением! Готов к новым достижениям?',
    mentor: '🎯 С возвращением! Как дела с целями?',
    neutral: '📊 С возвращением! Продолжаем работу.'
  };
  
  return templates[tone];
}

/**
 * Сообщения онбординга
 */
export function getOnboardingMessage(step: string, tone: Tone): string {
  const stepMessages: Record<string, MessageTemplate> = {
    age: {
      coach: '👋 Привет! Для персонального плана нужны твои данные!\n\n📅 Сколько тебе лет?',
      mentor: '👋 Добро пожаловать! Для персонального плана нужны ваши данные.\n\n📅 Сколько вам лет?',
      neutral: '👋 Добро пожаловать! Для персонального плана нужны данные.\n\n📅 Сколько вам лет?'
    },
    sex: {
      coach: '👤 Укажи свой пол:\n\n• Мужской\n• Женский',
      mentor: '👤 Укажите ваш пол:\n\n• Мужской\n• Женский',
      neutral: '👤 Укажите пол:\n\n• Мужской\n• Женский'
    },
    height: {
      coach: '📏 Какой у тебя рост в сантиметрах?\n\nНапример: 175',
      mentor: '📏 Какой у вас рост в сантиметрах?\n\nНапример: 175',
      neutral: '📏 Рост в сантиметрах:\n\nНапример: 175'
    },
    weight: {
      coach: '⚖️ Какой у тебя текущий вес в килограммах?\n\nНапример: 70',
      mentor: '⚖️ Какой у вас текущий вес в килограммах?\n\nНапример: 70',
      neutral: '⚖️ Текущий вес в килограммах:\n\nНапример: 70'
    },
    activity: {
      coach: '🏃‍♂️ Какой у тебя уровень активности?\n\n• Малоподвижный (офис)\n• Лёгкая (1-3 тренировки/неделя)\n• Умеренная (3-5 тренировок/неделя)\n• Высокая (6-7 тренировок/неделя)\n• Очень высокая (2+ тренировки/день)',
      mentor: '🏃‍♂️ Какой у вас уровень активности?\n\n• Малоподвижный (офисная работа)\n• Лёгкая активность (1-3 тренировки/неделя)\n• Умеренная активность (3-5 тренировок/неделя)\n• Высокая активность (6-7 тренировок/неделя)\n• Очень высокая активность (2+ тренировки/день)',
      neutral: '🏃‍♂️ Уровень активности:\n\n• Малоподвижный\n• Лёгкая активность\n• Умеренная активность\n• Высокая активность\n• Очень высокая активность'
    },
    goal: {
      coach: '🎯 Какую цель ты преследуешь?\n\n• Похудение (сбросить вес)\n• Поддержание веса\n• Набор массы',
      mentor: '🎯 Какую цель вы преследуете?\n\n• Похудение (сбросить вес)\n• Поддержание веса\n• Набор массы',
      neutral: '🎯 Цель:\n\n• Похудение\n• Поддержание веса\n• Набор массы'
    }
  };
  
  return stepMessages[step]?.[tone] || 'Продолжаем настройку...';
}

/**
 * Сообщения помощи
 */
export function getHelpMessage(tone: Tone): string {
  const templates: MessageTemplate = {
    coach: `❓ ПОМОЩЬ ПО БОТУ

💪 ЧТО Я УМЕЮ:
• Анализирую еду из текста, фото и голоса
• Рассчитываю персональные нормы КБЖУ
• Составляю планы питания
• Отправляю ежедневные отчёты

🚀 КАК ПОЛЬЗОВАТЬСЯ:
• Отправляй описание еды: "ел курицу с рисом"
• Фотографируй блюда
• Используй голосовые сообщения
• Настраивай напоминания

Главное меню всегда доступно!`,
    
    mentor: `❓ Помощь по боту

🎯 Что я умею:
• Анализирую еду из текста, фото и голоса
• Рассчитываю персональные нормы КБЖУ
• Составляю планы питания
• Отправляю ежедневные отчёты

📝 Как пользоваться:
• Отправляйте описание еды: "ел курицу с рисом"
• Фотографируйте блюда
• Используйте голосовые сообщения
• Настраивайте напоминания

Главное меню всегда доступно!`,
    
    neutral: `❓ Помощь по боту

Функции:
• Анализ еды из текста, фото и голоса
• Расчёт персональных норм КБЖУ
• Составление планов питания
• Ежедневные отчёты

Использование:
• Отправляйте описание еды
• Фотографируйте блюда
• Используйте голосовые сообщения
• Настраивайте напоминания

Главное меню всегда доступно.`
  };
  
  return templates[tone];
}

/**
 * Сообщения для голосового ввода
 */
export function getVoiceResponse(intent: string, tone: Tone): string {
  const templates: Record<string, MessageTemplate> = {
    meal_add: {
      coach: '🍽️ Добавляю приём пищи! Отличный выбор! 💪',
      mentor: '🍽️ Добавляю приём пищи. Хороший выбор!',
      neutral: '🍽️ Добавляю приём пищи.'
    },
    weight_update: {
      coach: '⚖️ Обновляю вес! Отслеживаем прогресс! 💪',
      mentor: '⚖️ Обновляю вес. Отслеживаем прогресс.',
      neutral: '⚖️ Обновляю вес.'
    },
    macro_adjust: {
      coach: '⚙️ Корректирую макросы! Настраиваем под тебя! 💪',
      mentor: '⚙️ Корректирую макросы. Настраиваем под вас.',
      neutral: '⚙️ Корректирую макросы.'
    },
    reminder_set: {
      coach: '⏰ Устанавливаю напоминание! Не забудем о целях! 💪',
      mentor: '⏰ Устанавливаю напоминание. Поможет не забыть.',
      neutral: '⏰ Устанавливаю напоминание.'
    },
    unclear: {
      coach: '🤔 Не совсем понял! Попробуй сказать:\n• "Добавь курицу 200 ккал"\n• "Обнови вес 75 кг"\n• "Пересчитай макросы: белок +20г"\n• "Поставь отчёт на 21:00"',
      mentor: '🤔 Не совсем понял. Попробуйте сказать:\n• "Добавь курицу 200 ккал"\n• "Обнови вес 75 кг"\n• "Пересчитай макросы: белок +20г"\n• "Поставь отчёт на 21:00"',
      neutral: '🤔 Не понял. Попробуйте:\n• "Добавь курицу 200 ккал"\n• "Обнови вес 75 кг"\n• "Пересчитай макросы: белок +20г"\n• "Поставь отчёт на 21:00"'
    }
  };
  
  return templates[intent]?.[tone] || 'Обрабатываю ваш запрос...';
}

/**
 * Получение тона пользователя из настроек
 */
export function getUserTone(userTone?: string): Tone {
  if (userTone === 'coach' || userTone === 'mentor' || userTone === 'neutral') {
    return userTone;
  }
  return 'mentor'; // по умолчанию
}

export default {
  getPlanCard,
  getDaySummaryCard,
  getConfirmationMessage,
  getErrorMessage,
  getRetryMessage,
  getWelcomeMessage,
  getOnboardingMessage,
  getHelpMessage,
  getVoiceResponse,
  getUserTone
};
