// Расчетный движок для нутрициологического бота
// Реализует формулы BMR, TDEE, макросы и валидацию согласно требованиям

// Константы для расчетов
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9
} as const;

const GOAL_ADJUSTMENTS = {
  fat_loss: -0.15,    // -15% для похудения
  maintain: 0,        // 0% для поддержания
  gain: 0.10          // +10% для набора
} as const;

const MACRO_DEFAULTS = {
  protein_per_kg: 1.6,  // 1.6г белка на кг веса
  protein_min: 1.4,     // минимум 1.4г/кг
  protein_max: 2.2,     // максимум 2.2г/кг
  fat_per_kg: 0.8,      // 0.8г жира на кг веса
  fat_min: 0.6,         // минимум 0.6г/кг
  fat_max: 1.2          // максимум 1.2г/кг
} as const;

const CALORIE_ROUNDING = 5;  // ±5 ккал
const GRAM_ROUNDING = 1;    // ±1 г

// Интерфейсы для типизации
interface UserParams {
  age: number;
  sex: 'male' | 'female';
  height_cm: number;
  weight_kg: number;
  activity: keyof typeof ACTIVITY_MULTIPLIERS;
  goal: keyof typeof GOAL_ADJUSTMENTS;
}

interface NutritionPlan {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  bmr: number;
  tdee: number;
}

interface MacroAdjustment {
  protein?: { value: number; type: 'grams' | 'percent' };
  fat?: { value: number; type: 'grams' | 'percent' };
  carbs?: { value: number; type: 'grams' | 'percent' };
}

// Основные функции расчета

/**
 * Расчет базового метаболизма по формуле Миффлина-Сан Жеора
 */
export function calculateBMR(params: UserParams): number {
  const { age, sex, height_cm, weight_kg } = params;
  
  // Формула Миффлина-Сан Жеора
  let bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  
  // Корректировка по полу
  if (sex === 'male') {
    bmr += 5;
  } else {
    bmr -= 161;
  }
  
  return Math.round(bmr);
}

/**
 * Расчет общего дневного расхода энергии (TDEE)
 */
export function calculateTDEE(bmr: number, activity: keyof typeof ACTIVITY_MULTIPLIERS): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activity];
  return Math.round(bmr * multiplier);
}

/**
 * Расчет целевых калорий с учетом цели
 */
export function calculateTargetCalories(tdee: number, goal: keyof typeof GOAL_ADJUSTMENTS): number {
  const adjustment = GOAL_ADJUSTMENTS[goal];
  const targetCalories = tdee * (1 + adjustment);
  
  // Ограничиваем границы: -25% до +15%
  const minCalories = tdee * 0.75;  // -25%
  const maxCalories = tdee * 1.15;  // +15%
  
  return Math.max(minCalories, Math.min(maxCalories, targetCalories));
}

/**
 * Расчет макросов по умолчанию
 */
export function calculateDefaultMacros(targetCalories: number, weight_kg: number): Omit<NutritionPlan, 'kcal' | 'bmr' | 'tdee'> {
  // Белки: 1.6г на кг веса (минимум 1.4, максимум 2.2)
  const proteinPerKg = Math.max(MACRO_DEFAULTS.protein_min, 
                               Math.min(MACRO_DEFAULTS.protein_max, MACRO_DEFAULTS.protein_per_kg));
  const protein = proteinPerKg * weight_kg;
  
  // Жиры: 0.8г на кг веса (минимум 0.6, максимум 1.2)
  const fatPerKg = Math.max(MACRO_DEFAULTS.fat_min, 
                            Math.min(MACRO_DEFAULTS.fat_max, MACRO_DEFAULTS.fat_per_kg));
  const fat = fatPerKg * weight_kg;
  
  // Углеводы: остаток калорий
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const remainingCalories = targetCalories - proteinCalories - fatCalories;
  const carbs = Math.max(0, remainingCalories / 4);
  
  return {
    protein: Math.round(protein * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    carbs: Math.round(carbs * 10) / 10
  };
}

/**
 * Полный расчет плана питания
 */
export function calculateNutritionPlan(params: UserParams): NutritionPlan {
  const bmr = calculateBMR(params);
  const tdee = calculateTDEE(bmr, params.activity);
  const targetCalories = calculateTargetCalories(tdee, params.goal);
  const macros = calculateDefaultMacros(targetCalories, params.weight_kg);
  
  return {
    kcal: Math.round(targetCalories),
    bmr,
    tdee,
    ...macros
  };
}

/**
 * Валидация и корректировка макросов
 */
export function validateAndAdjustMacros(
  plan: NutritionPlan, 
  adjustments: MacroAdjustment,
  weight_kg: number
): { plan: NutritionPlan; warnings: string[] } {
  const warnings: string[] = [];
  let newPlan = { ...plan };
  
  // Применяем корректировки
  if (adjustments.protein) {
    const { value, type } = adjustments.protein;
    if (type === 'grams') {
      newPlan.protein = value;
    } else if (type === 'percent') {
      newPlan.protein = plan.protein * (1 + value / 100);
    }
  }
  
  if (adjustments.fat) {
    const { value, type } = adjustments.fat;
    if (type === 'grams') {
      newPlan.fat = value;
    } else if (type === 'percent') {
      newPlan.fat = plan.fat * (1 + value / 100);
    }
  }
  
  if (adjustments.carbs) {
    const { value, type } = adjustments.carbs;
    if (type === 'grams') {
      newPlan.carbs = value;
    } else if (type === 'percent') {
      newPlan.carbs = plan.carbs * (1 + value / 100);
    }
  }
  
  // Валидация минимумов
  const minProtein = weight_kg * MACRO_DEFAULTS.protein_min;
  const minFat = weight_kg * MACRO_DEFAULTS.fat_min;
  
  if (newPlan.protein < minProtein) {
    warnings.push(`Белок слишком низкий (${newPlan.protein.toFixed(1)}г). Минимум ${minProtein.toFixed(1)}г/кг - исправляю автоматически.`);
    newPlan.protein = minProtein;
  }
  
  if (newPlan.fat < minFat) {
    warnings.push(`Жиры слишком низкие (${newPlan.fat.toFixed(1)}г). Минимум ${minFat.toFixed(1)}г/кг - исправляю автоматически.`);
    newPlan.fat = minFat;
  }
  
  // Пересчитываем углеводы для сохранения целевых калорий
  const proteinCalories = newPlan.protein * 4;
  const fatCalories = newPlan.fat * 9;
  const remainingCalories = newPlan.kcal - proteinCalories - fatCalories;
  newPlan.carbs = Math.max(0, remainingCalories / 4);
  
  // Округление
  newPlan.protein = Math.round(newPlan.protein * 10) / 10;
  newPlan.fat = Math.round(newPlan.fat * 10) / 10;
  newPlan.carbs = Math.round(newPlan.carbs * 10) / 10;
  
  return { plan: newPlan, warnings };
}

/**
 * Парсинг корректировок макросов из текста
 */
export function parseMacroAdjustments(text: string): MacroAdjustment {
  const adjustments: MacroAdjustment = {};
  
  // Паттерны для граммов
  const proteinGramsMatch = text.match(/белк[а-я]*\s*(\d+)\s*г/i);
  const fatGramsMatch = text.match(/жир[а-я]*\s*(\d+)\s*г/i);
  const carbsGramsMatch = text.match(/углевод[а-я]*\s*(\d+)\s*г/i);
  
  // Паттерны для процентов
  const proteinPercentMatch = text.match(/белк[а-я]*\s*([+-]?\d+)\s*%/i);
  const fatPercentMatch = text.match(/жир[а-я]*\s*([+-]?\d+)\s*%/i);
  const carbsPercentMatch = text.match(/углевод[а-я]*\s*([+-]?\d+)\s*%/i);
  
  if (proteinGramsMatch) {
    adjustments.protein = { value: parseInt(proteinGramsMatch[1]), type: 'grams' };
  } else if (proteinPercentMatch) {
    adjustments.protein = { value: parseInt(proteinPercentMatch[1]), type: 'percent' };
  }
  
  if (fatGramsMatch) {
    adjustments.fat = { value: parseInt(fatGramsMatch[1]), type: 'grams' };
  } else if (fatPercentMatch) {
    adjustments.fat = { value: parseInt(fatPercentMatch[1]), type: 'percent' };
  }
  
  if (carbsGramsMatch) {
    adjustments.carbs = { value: parseInt(carbsGramsMatch[1]), type: 'grams' };
  } else if (carbsPercentMatch) {
    adjustments.carbs = { value: parseInt(carbsPercentMatch[1]), type: 'percent' };
  }
  
  return adjustments;
}

/**
 * Создание правил корректировки для сохранения в БД
 */
export function createRulesJson(adjustments: MacroAdjustment): object {
  const rules: any = {};
  
  if (adjustments.protein) {
    rules.protein = {
      value: adjustments.protein.value,
      type: adjustments.protein.type
    };
  }
  
  if (adjustments.fat) {
    rules.fat = {
      value: adjustments.fat.value,
      type: adjustments.fat.type
    };
  }
  
  if (adjustments.carbs) {
    rules.carbs = {
      value: adjustments.carbs.value,
      type: adjustments.carbs.type
    };
  }
  
  return rules;
}

/**
 * Форматирование плана для отображения
 */
export function formatPlanCard(plan: NutritionPlan, userParams: UserParams): string {
  const goalText = {
    fat_loss: 'похудение',
    maintain: 'поддержание',
    gain: 'набор массы'
  }[userParams.goal];
  
  const activityText = {
    sedentary: 'малоподвижный',
    light: 'легкая активность',
    moderate: 'умеренная активность',
    high: 'высокая активность',
    very_high: 'очень высокая активность'
  }[userParams.activity];
  
  return `📊 ВАШ ПЛАН ПИТАНИЯ

👤 Параметры:
• ${userParams.age} лет, ${userParams.sex === 'male' ? 'мужчина' : 'женщина'}
• ${userParams.height_cm}см, ${userParams.weight_kg}кг
• Цель: ${goalText}
• Активность: ${activityText}

🔥 Расчеты:
• BMR: ${plan.bmr} ккал
• TDEE: ${plan.tdee} ккал
• Целевые калории: ${plan.kcal} ккал

📊 Макросы:
• Белки: ${plan.protein}г
• Жиры: ${plan.fat}г  
• Углеводы: ${plan.carbs}г

💡 Рекомендации:
• Пейте ${Math.round(plan.kcal * 0.4)}мл воды в день
• Ешьте каждые 3-4 часа
• Следите за качеством сна`;
}

// Экспорт для использования в основном коде
export default {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  calculateDefaultMacros,
  calculateNutritionPlan,
  validateAndAdjustMacros,
  parseMacroAdjustments,
  createRulesJson,
  formatPlanCard
};
