// Система памяти и контекста для персонализации
// Хранение предпочтений, истории и контекста разговора

// Типы для типизации
interface UserMemory {
  preferences: {
    diet: string;
    dislikes: string[];
    allergies: string[];
    eat_window_start?: string;
    eat_window_end?: string;
  };
  recent_meals: Array<{
    name: string;
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    date: string;
  }>;
  last_plan: {
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
    rules_json: any;
  };
  context_messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  last_menu: string;
  user_feedback: Array<{
    type: 'positive' | 'negative' | 'suggestion';
    content: string;
    timestamp: string;
  }>;
}

interface ContextData {
  last_menu: string;
  last_msgs_json: any[];
  updated_at: string;
}

// Константы
const MAX_CONTEXT_MESSAGES = 10;
const MAX_RECENT_MEALS = 7; // дней
const MAX_FEEDBACK_ITEMS = 20;

// Основные функции

/**
 * Получение памяти пользователя
 */
export async function getUserMemory(userId: number, supabase: any): Promise<UserMemory> {
  try {
    // Получаем предпочтения
    const { data: preferences } = await supabase
      .from('preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    // Получаем последний активный план
    const { data: plan } = await supabase
      .from('plans')
      .select('kcal, p, f, c, rules_json')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    
    // Получаем состояние
    const { data: state } = await supabase
      .from('state')
      .select('last_menu, last_msgs_json')
      .eq('user_id', userId)
      .single();
    
    // Получаем последние приёмы пищи
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - MAX_RECENT_MEALS);
    
    const { data: recentMeals } = await supabase
      .from('meals')
      .select('meal_name, kcal, protein, fat, carbs, ts')
      .eq('user_id', userId)
      .gte('ts', sevenDaysAgo.toISOString())
      .order('ts', { ascending: false })
      .limit(50);
    
    return {
      preferences: {
        diet: preferences?.diet || 'default',
        dislikes: preferences?.dislikes ? preferences.dislikes.split(',').map(s => s.trim()) : [],
        allergies: preferences?.allergies ? preferences.allergies.split(',').map(s => s.trim()) : [],
        eat_window_start: preferences?.eat_window_start,
        eat_window_end: preferences?.eat_window_end
      },
      recent_meals: recentMeals?.map(meal => ({
        name: meal.meal_name,
        calories: meal.kcal,
        protein: meal.protein,
        fat: meal.fat,
        carbs: meal.carbs,
        date: meal.ts.split('T')[0]
      })) || [],
      last_plan: plan ? {
        kcal: plan.kcal,
        protein: plan.p,
        fat: plan.f,
        carbs: plan.c,
        rules_json: plan.rules_json
      } : {
        kcal: 2000,
        protein: 150,
        fat: 70,
        carbs: 200,
        rules_json: {}
      },
      context_messages: state?.last_msgs_json || [],
      last_menu: state?.last_menu || 'main',
      user_feedback: [] // TODO: добавить таблицу для фидбека
    };
  } catch (error) {
    console.error('Error getting user memory:', error);
    return getDefaultMemory();
  }
}

/**
 * Получение памяти по умолчанию
 */
function getDefaultMemory(): UserMemory {
  return {
    preferences: {
      diet: 'default',
      dislikes: [],
      allergies: [],
    },
    recent_meals: [],
    last_plan: {
      kcal: 2000,
      protein: 150,
      fat: 70,
      carbs: 200,
      rules_json: {}
    },
    context_messages: [],
    last_menu: 'main',
    user_feedback: []
  };
}

/**
 * Сохранение сообщения в контекст
 */
export async function addToContext(
  userId: number,
  role: 'user' | 'assistant',
  content: string,
  supabase: any
): Promise<void> {
  try {
    // Получаем текущий контекст
    const { data: state } = await supabase
      .from('state')
      .select('last_msgs_json')
      .eq('user_id', userId)
      .single();
    
    const context = state?.last_msgs_json || [];
    
    // Добавляем новое сообщение
    context.push({
      role,
      content: content.slice(0, 500), // ограничиваем длину
      timestamp: new Date().toISOString()
    });
    
    // Ограничиваем контекст последними сообщениями
    const limitedContext = context.slice(-MAX_CONTEXT_MESSAGES);
    
    // Сохраняем обновленный контекст
    await supabase
      .from('state')
      .upsert({
        user_id: userId,
        last_msgs_json: limitedContext,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
    
  } catch (error) {
    console.error('Error adding to context:', error);
  }
}

/**
 * Обновление последнего меню
 */
export async function updateLastMenu(
  userId: number,
  menu: string,
  supabase: any
): Promise<void> {
  try {
    await supabase
      .from('state')
      .upsert({
        user_id: userId,
        last_menu: menu,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
  } catch (error) {
    console.error('Error updating last menu:', error);
  }
}

/**
 * Анализ предпочтений пользователя из контекста
 */
export function analyzeUserPreferences(memory: UserMemory): {
  diet_preferences: string[];
  disliked_foods: string[];
  preferred_times: string[];
  feedback_patterns: string[];
} {
  const dietPreferences: string[] = [];
  const dislikedFoods: string[] = [];
  const preferredTimes: string[] = [];
  const feedbackPatterns: string[] = [];
  
  // Анализируем контекст сообщений
  memory.context_messages.forEach(msg => {
    const content = msg.content.toLowerCase();
    
    // Предпочтения в еде
    if (content.includes('люблю') || content.includes('нравится') || content.includes('обожаю')) {
      const foods = extractFoodsFromText(msg.content);
      dietPreferences.push(...foods);
    }
    
    // Нелюбимые продукты
    if (content.includes('не люблю') || content.includes('не нравится') || content.includes('не ем')) {
      const foods = extractFoodsFromText(msg.content);
      dislikedFoods.push(...foods);
    }
    
    // Время приёмов пищи
    if (content.includes('утром') || content.includes('завтрак')) {
      preferredTimes.push('breakfast');
    }
    if (content.includes('днём') || content.includes('обед')) {
      preferredTimes.push('lunch');
    }
    if (content.includes('вечером') || content.includes('ужин')) {
      preferredTimes.push('dinner');
    }
    
    // Паттерны обратной связи
    if (content.includes('слишком') || content.includes('много') || content.includes('мало')) {
      feedbackPatterns.push('portion_feedback');
    }
    if (content.includes('вкусно') || content.includes('понравилось')) {
      feedbackPatterns.push('positive_feedback');
    }
  });
  
  // Анализируем недавние приёмы пищи
  const recentFoods = memory.recent_meals.map(meal => meal.name.toLowerCase());
  const foodFrequency = recentFoods.reduce((acc, food) => {
    acc[food] = (acc[food] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Добавляем часто употребляемые продукты в предпочтения
  Object.entries(foodFrequency).forEach(([food, count]) => {
    if (count >= 3 && !dislikedFoods.includes(food)) {
      dietPreferences.push(food);
    }
  });
  
  return {
    diet_preferences: [...new Set(dietPreferences)],
    disliked_foods: [...new Set(dislikedFoods)],
    preferred_times: [...new Set(preferredTimes)],
    feedback_patterns: [...new Set(feedbackPatterns)]
  };
}

/**
 * Извлечение названий продуктов из текста
 */
function extractFoodsFromText(text: string): string[] {
  const foods: string[] = [];
  const foodKeywords = [
    'курица', 'мясо', 'говядина', 'свинина', 'баранина',
    'рыба', 'лосось', 'треска', 'тунец', 'креветки',
    'овощи', 'морковь', 'картофель', 'помидоры', 'огурцы',
    'фрукты', 'яблоки', 'бананы', 'апельсины', 'ягоды',
    'крупы', 'гречка', 'рис', 'овсянка', 'перловка',
    'молочные', 'молоко', 'творог', 'сыр', 'йогурт',
    'орехи', 'миндаль', 'грецкие', 'кешью',
    'масло', 'оливковое', 'подсолнечное', 'сливочное'
  ];
  
  foodKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword)) {
      foods.push(keyword);
    }
  });
  
  return foods;
}

/**
 * Генерация персонального совета на основе памяти
 */
export function generatePersonalizedAdvice(
  memory: UserMemory,
  currentMeal?: any,
  question?: string
): string {
  const preferences = analyzeUserPreferences(memory);
  
  // Если есть вопрос, отвечаем на него с учётом предпочтений
  if (question) {
    return answerQuestionWithContext(question, preferences, memory);
  }
  
  // Если добавляем приём пищи, даём совет на основе истории
  if (currentMeal) {
    return generateMealAdvice(currentMeal, preferences, memory);
  }
  
  // Общий совет на основе предпочтений
  return generateGeneralAdvice(preferences, memory);
}

/**
 * Ответ на вопрос с учётом контекста
 */
function answerQuestionWithContext(
  question: string,
  preferences: any,
  memory: UserMemory
): string {
  const q = question.toLowerCase();
  
  if (q.includes('что поесть') || q.includes('что съесть')) {
    const suggestions = generateFoodSuggestions(preferences, memory);
    return `🍽️ Рекомендую:\n${suggestions.join('\n')}`;
  }
  
  if (q.includes('рецепт')) {
    const recipe = generateRecipeSuggestion(preferences, memory);
    return `👨‍🍳 Рецепт для вас:\n${recipe}`;
  }
  
  if (q.includes('время') || q.includes('когда')) {
    return generateTimingAdvice(preferences, memory);
  }
  
  return 'Расскажите подробнее, что вас интересует?';
}

/**
 * Генерация советов по еде
 */
function generateFoodSuggestions(preferences: any, memory: UserMemory): string[] {
  const suggestions: string[] = [];
  
  // На основе предпочтений
  if (preferences.diet_preferences.length > 0) {
    suggestions.push(`• ${preferences.diet_preferences.slice(0, 3).join(', ')}`);
  }
  
  // На основе времени дня
  const hour = new Date().getHours();
  if (hour < 10) {
    suggestions.push('• Овсянка с фруктами');
    suggestions.push('• Яйца с овощами');
  } else if (hour < 15) {
    suggestions.push('• Курица с рисом');
    suggestions.push('• Салат с белком');
  } else {
    suggestions.push('• Рыба с овощами');
    suggestions.push('• Творог с ягодами');
  }
  
  return suggestions.slice(0, 3);
}

/**
 * Генерация рецепта
 */
function generateRecipeSuggestion(preferences: any, memory: UserMemory): string {
  const favoriteFoods = preferences.diet_preferences.slice(0, 2);
  
  if (favoriteFoods.length > 0) {
    return `🍽️ ${favoriteFoods.join(' с ')} - простое и вкусное блюдо с учётом ваших предпочтений!`;
  }
  
  return '🍽️ Куриная грудка с овощами - сбалансированное блюдо с высоким содержанием белка.';
}

/**
 * Генерация советов по времени
 */
function generateTimingAdvice(preferences: any, memory: UserMemory): string {
  const hour = new Date().getHours();
  
  if (hour < 9) {
    return '🌅 Идеальное время для завтрака! Рекомендую белок + углеводы.';
  } else if (hour < 13) {
    return '☀️ Время обеда! Сбалансированное блюдо с белком, углеводами и овощами.';
  } else if (hour < 18) {
    return '🍎 Время перекуса! Легкий перекус с белком или фрукты.';
  } else {
    return '🌆 Время ужина! Легкий ужин с белком и овощами.';
  }
}

/**
 * Генерация совета по приёму пищи
 */
function generateMealAdvice(meal: any, preferences: any, memory: UserMemory): string {
  const advice: string[] = [];
  
  // Анализ баланса
  if (meal.protein_percent < 20) {
    advice.push('Добавьте белок к следующему приёму пищи.');
  }
  
  if (meal.carbs_percent > 60) {
    advice.push('Много углеводов. Больше овощей в следующий раз.');
  }
  
  // Учёт предпочтений
  if (preferences.disliked_foods.some((food: string) => 
    meal.name.toLowerCase().includes(food))) {
    advice.push('Попробуйте альтернативы, которые вам больше нравятся.');
  }
  
  return advice.length > 0 ? advice.join(' ') : 'Хороший выбор!';
}

/**
 * Генерация общего совета
 */
function generateGeneralAdvice(preferences: any, memory: UserMemory): string {
  const advice: string[] = [];
  
  // На основе предпочтений
  if (preferences.diet_preferences.length > 0) {
    advice.push(`Продолжайте есть ${preferences.diet_preferences.slice(0, 2).join(' и ')} - это вам нравится!`);
  }
  
  // На основе недавних приёмов пищи
  if (memory.recent_meals.length > 0) {
    const avgProtein = memory.recent_meals.reduce((sum, meal) => sum + meal.protein, 0) / memory.recent_meals.length;
    if (avgProtein < 20) {
      advice.push('Добавьте больше белка в рацион.');
    }
  }
  
  return advice.length > 0 ? advice.join(' ') : 'Продолжайте следить за балансом КБЖУ!';
}

/**
 * Сохранение обратной связи пользователя
 */
export async function saveUserFeedback(
  userId: number,
  type: 'positive' | 'negative' | 'suggestion',
  content: string,
  supabase: any
): Promise<void> {
  try {
    // TODO: создать таблицу user_feedback
    console.log(`User ${userId} feedback: ${type} - ${content}`);
  } catch (error) {
    console.error('Error saving user feedback:', error);
  }
}

export default {
  getUserMemory,
  addToContext,
  updateLastMenu,
  analyzeUserPreferences,
  generatePersonalizedAdvice,
  saveUserFeedback
};
