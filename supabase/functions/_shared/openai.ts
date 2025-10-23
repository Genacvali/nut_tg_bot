/**
 * Утилиты для работы с OpenAI API
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Генерация плана КБЖУ через OpenAI
 */
export async function generateNutritionPlan(params: {
  age: number
  gender: string
  height: number
  currentWeight: number
  targetWeight: number
  activityLevel: string
  goal: string
  method: string
}): Promise<any> {
  const prompt = `Ты - профессиональный диетолог. Рассчитай КБЖУ для клиента и объясни методику.

Данные клиента:
- Возраст: ${params.age} лет
- Пол: ${params.gender === 'male' ? 'мужской' : 'женский'}
- Рост: ${params.height} см
- Текущий вес: ${params.currentWeight} кг
- Целевой вес: ${params.targetWeight} кг
- Уровень активности: ${params.activityLevel}
- Цель: ${params.goal}
- Метод расчета: ${params.method}

Выполни следующее:
1. Рассчитай базовый метаболизм (BMR) используя формулу ${params.method}
2. Рассчитай общий расход калорий (TDEE) с учетом активности
3. Определи целевую калорийность в зависимости от цели
4. Рассчитай оптимальное распределение БЖУ
5. Подробно объясни, почему выбраны именно эти значения

Верни результат СТРОГО в формате JSON:
{
    "bmr": число,
    "tdee": число,
    "target_calories": число,
    "protein_grams": число,
    "fats_grams": число,
    "carbs_grams": число,
    "explanation": "подробное объяснение расчетов и методики"
}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Ты опытный диетолог и нутрициолог. Всегда отвечай на русском языке в формате JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}

/**
 * Анализ еды и расчет КБЖУ
 */
export async function analyzeFood(description: string): Promise<any> {
  const prompt = `Ты - эксперт по питанию. Проанализируй описание еды и оцени примерное содержание КБЖУ.

Описание: "${description}"

Оцени примерное содержание калорий, белков, жиров и углеводов.
Если описание недостаточно подробное, сделай разумные предположения на основе типичных порций.

Верни результат в формате JSON:
{
    "food_name": "название блюда",
    "calories": число,
    "protein": число,
    "fats": число,
    "carbs": число,
    "portion_note": "примечание о размере порции"
}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Ты эксперт-нутрициолог. Анализируешь еду и оцениваешь КБЖУ.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}

/**
 * Предложение блюда на основе запроса
 */
export async function suggestMeal(params: {
  userRequest: string
  nutritionPlan: any
  dailyConsumed: any
}): Promise<any> {
  const remaining = {
    calories: params.nutritionPlan.calories - (params.dailyConsumed.calories || 0),
    protein: params.nutritionPlan.protein - (params.dailyConsumed.protein || 0),
    fats: params.nutritionPlan.fats - (params.dailyConsumed.fats || 0),
    carbs: params.nutritionPlan.carbs - (params.dailyConsumed.carbs || 0)
  }

  const prompt = `Ты - персональный шеф-повар и диетолог. Предложи блюдо клиенту.

Запрос клиента: "${params.userRequest}"

Дневная норма КБЖУ:
- Калории: ${params.nutritionPlan.calories} ккал
- Белки: ${params.nutritionPlan.protein} г
- Жиры: ${params.nutritionPlan.fats} г
- Углеводы: ${params.nutritionPlan.carbs} г

Уже употреблено сегодня:
- Калории: ${params.dailyConsumed.calories || 0} ккал
- Белки: ${params.dailyConsumed.protein || 0} г
- Жиры: ${params.dailyConsumed.fats || 0} г
- Углеводы: ${params.dailyConsumed.carbs || 0} г

Осталось до нормы:
- Калории: ${remaining.calories} ккал
- Белки: ${remaining.protein} г
- Жиры: ${remaining.fats} г
- Углеводы: ${remaining.carbs} г

Предложи блюдо или рецепт, которое:
1. Подходит под запрос клиента
2. Вписывается в оставшуюся норму КБЖУ
3. Вкусное и легкое в приготовлении

Верни результат в формате JSON:
{
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
}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Ты персональный шеф-повар и диетолог. Предлагаешь вкусные и здоровые блюда.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}

/**
 * Общение с AI ассистентом
 */
export async function chatWithAI(userMessage: string, context?: OpenAIMessage[]): Promise<string> {
  const messages: OpenAIMessage[] = [
    {
      role: 'system',
      content: 'Ты персональный AI-ассистент по питанию и здоровому образу жизни. Помогаешь людям достигать их целей по питанию.'
    }
  ]

  if (context && context.length > 0) {
    messages.push(...context.slice(-10)) // Последние 10 сообщений
  }

  messages.push({ role: 'user', content: userMessage })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.8,
      max_tokens: 1000
    })
  })

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Транскрипция голосового сообщения через Whisper
 */
export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer]), 'audio.ogg')
  formData.append('model', 'whisper-1')
  formData.append('language', 'ru')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData
  })

  const data = await response.json()
  return data.text
}

