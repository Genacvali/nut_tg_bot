/**
 * Калькуляторы КБЖУ и метаболизма
 */

/**
 * Расчет BMR по формуле Миффлина-Сан Жеора
 */
export function calculateBMRMifflin(
  weight: number,
  height: number,
  age: number,
  gender: string
): number {
  if (gender === 'male') {
    return (10 * weight) + (6.25 * height) - (5 * age) + 5
  } else {
    return (10 * weight) + (6.25 * height) - (5 * age) - 161
  }
}

/**
 * Расчет BMR по формуле Харриса-Бенедикта
 */
export function calculateBMRHarris(
  weight: number,
  height: number,
  age: number,
  gender: string
): number {
  if (gender === 'male') {
    return 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age)
  } else {
    return 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age)
  }
}

/**
 * Расчет TDEE с учетом уровня активности
 */
export function calculateTDEE(bmr: number, activityLevel: string): number {
  const multipliers: { [key: string]: number } = {
    'sedentary': 1.2,
    'light': 1.375,
    'moderate': 1.55,
    'active': 1.725,
    'very_active': 1.9
  }

  return bmr * (multipliers[activityLevel] || 1.2)
}

/**
 * Расчет целевой калорийности в зависимости от цели
 */
export function calculateTargetCalories(tdee: number, goal: string): number {
  if (goal === 'lose') {
    return Math.round(tdee * 0.85)
  } else if (goal === 'gain') {
    return Math.round(tdee * 1.15)
  } else {
    return Math.round(tdee)
  }
}

/**
 * Расчет макронутриентов
 */
export function calculateMacros(targetCalories: number, goal: string): {
  protein: number
  fats: number
  carbs: number
} {
  let proteinPercent: number
  let fatPercent: number
  let carbPercent: number

  if (goal === 'lose') {
    proteinPercent = 0.35
    fatPercent = 0.25
    carbPercent = 0.40
  } else if (goal === 'gain') {
    proteinPercent = 0.30
    fatPercent = 0.25
    carbPercent = 0.45
  } else {
    proteinPercent = 0.30
    fatPercent = 0.30
    carbPercent = 0.40
  }

  return {
    protein: Math.round((targetCalories * proteinPercent) / 4 * 10) / 10,
    fats: Math.round((targetCalories * fatPercent) / 9 * 10) / 10,
    carbs: Math.round((targetCalories * carbPercent) / 4 * 10) / 10
  }
}

/**
 * Полный расчет плана питания
 */
export function calculateFullNutritionPlan(params: {
  weight: number
  height: number
  age: number
  gender: string
  activityLevel: string
  goal: string
  method: string
}): {
  bmr: number
  tdee: number
  targetCalories: number
  protein: number
  fats: number
  carbs: number
} {
  // Расчет BMR
  const bmr = params.method === 'mifflin'
    ? calculateBMRMifflin(params.weight, params.height, params.age, params.gender)
    : calculateBMRHarris(params.weight, params.height, params.age, params.gender)

  // Расчет TDEE
  const tdee = calculateTDEE(bmr, params.activityLevel)

  // Целевая калорийность
  const targetCalories = calculateTargetCalories(tdee, params.goal)

  // Макронутриенты
  const macros = calculateMacros(targetCalories, params.goal)

  return {
    bmr: Math.round(bmr * 10) / 10,
    tdee: Math.round(tdee * 10) / 10,
    targetCalories,
    protein: macros.protein,
    fats: macros.fats,
    carbs: macros.carbs
  }
}

/**
 * Получить объяснение методики расчета
 */
export function getMethodologyExplanation(
  method: string,
  goal: string,
  activityLevel: string,
  bmr: number,
  tdee: number,
  targetCalories: number
): string {
  const methodName = method === 'mifflin' ? 'Миффлина-Сан Жеора' : 'Харриса-Бенедикта'

  const activityNames: { [key: string]: string } = {
    'sedentary': 'сидячий образ жизни (коэффициент 1.2)',
    'light': 'легкая активность 1-3 раза в неделю (коэффициент 1.375)',
    'moderate': 'умеренная активность 3-5 раз в неделю (коэффициент 1.55)',
    'active': 'высокая активность 6-7 раз в неделю (коэффициент 1.725)',
    'very_active': 'очень высокая активность, тренировки 2 раза в день (коэффициент 1.9)'
  }

  const goalNames: { [key: string]: string } = {
    'lose': 'похудение (дефицит 15%)',
    'maintain': 'поддержание веса',
    'gain': 'набор массы (профицит 15%)'
  }

  return `📊 МЕТОДИКА РАСЧЕТА:

🔹 Базовый метаболизм (BMR): ${Math.round(bmr)} ккал/день
   Рассчитан по формуле ${methodName} - одной из самых точных современных формул.

🔹 Общий расход энергии (TDEE): ${Math.round(tdee)} ккал/день
   BMR умножен на коэффициент активности (${activityNames[activityLevel] || activityLevel})

🔹 Целевая калорийность: ${targetCalories} ккал/день
   Скорректирована под вашу цель: ${goalNames[goal] || goal}

🔹 Распределение макронутриентов:
   Оптимизировано для вашей цели с учетом эффективности усвоения и достижения результата.`
}

