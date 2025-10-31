import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}
interface TelegramMessage {
  message_id: number
  from: TelegramUser
  chat: TelegramChat
  text?: string
  voice?: TelegramVoice
  photo?: TelegramPhotoSize[]
  caption?: string
}
interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
  file_size?: number
}
interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}
interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}
interface TelegramUser {
  id: number
  username?: string
  first_name: string
}
interface TelegramChat {
  id: number
  type: string
}
// ============================================
// DEV BOT CONFIGURATION (@cid_tg_admin_bot)
// Используется для тестирования UI/UX
// ============================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN_DEV = Deno.env.get('TELEGRAM_BOT_TOKEN_DEV')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_DEV}`

// ============================================
// CONVERSATION MEMORY: Управление историей
// ============================================

interface ConversationMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  intent?: string
  confidence?: number
  created_at: string
}

interface IntentResult {
  intent: 'food' | 'water' | 'question' | 'navigation'
  confidence: number
  reasoning: string
  needsConfirmation: boolean
}

interface ConversationTopic {
  topic: string | null
  confidence: number
  messages_count: number
  is_active: boolean
  last_message_at?: string
}

class ConversationManager {
  /**
   * Получить последние N сообщений пользователя
   */
  static async getRecentMessages(userId: number, limit: number = 10): Promise<ConversationMessage[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_recent_messages', {
          p_user_id: userId,
          p_limit: limit
        })

      if (error) {
        console.error('Error getting recent messages:', error)
        return []
      }

      return (data || []).reverse() // Возвращаем в хронологическом порядке
    } catch (error) {
      console.error('Exception in getRecentMessages:', error)
      return []
    }
  }

  /**
   * Добавить сообщение в историю
   */
  static async addMessage(
    userId: number,
    role: 'user' | 'assistant',
    content: string,
    intent?: string,
    confidence?: number,
    metadata: any = {}
  ): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .rpc('add_conversation_message', {
          p_user_id: userId,
          p_role: role,
          p_content: content,
          p_intent: intent,
          p_confidence: confidence,
          p_metadata: metadata
        })

      if (error) {
        console.error('Error adding message:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Exception in addMessage:', error)
      return null
    }
  }

  /**
   * Получить текущую тему разговора
   */
  static async getCurrentTopic(userId: number): Promise<ConversationTopic | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_conversation_topic', { p_user_id: userId })

      if (error) {
        console.error('Error getting conversation topic:', error)
        return null
      }

      return data as ConversationTopic
    } catch (error) {
      console.error('Exception in getCurrentTopic:', error)
      return null
    }
  }

  /**
   * Очистить историю разговоров
   */
  static async clearContext(userId: number): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('clear_conversation_history', {
          p_user_id: userId,
          p_hard_delete: false
        })

      if (error) {
        console.error('Error clearing history:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Exception in clearContext:', error)
      return false
    }
  }

  /**
   * Проверить нужно ли очистить контекст (timeout 30 мин)
   */
  static async checkAndClearIfStale(userId: number): Promise<void> {
    const messages = await this.getRecentMessages(userId, 1)

    if (messages.length === 0) return

    const lastMessage = messages[0]
    const lastMessageTime = new Date(lastMessage.created_at).getTime()
    const now = Date.now()
    const TIMEOUT = 30 * 60 * 1000 // 30 минут

    if (now - lastMessageTime > TIMEOUT) {
      console.log(`Clearing stale context for user ${userId}`)
      await this.clearContext(userId)
    }
  }
}

/**
 * AI-based Intent Detection с контекстом
 */
async function detectIntentWithContext(
  text: string,
  userId: number,
  history: ConversationMessage[]
): Promise<IntentResult> {
  try {
    // Формируем контекст из истории
    const contextMessages = history.slice(-5).map(msg =>
      `${msg.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${msg.content}`
    ).join('\n')

    const prompt = `Ты - классификатор намерений для AI-диетолога C.I.D.

КОНТЕКСТ последних сообщений:
${contextMessages || 'Нет предыдущих сообщений'}

НОВОЕ сообщение от пользователя:
"${text}"

ЗАДАЧА: определи намерение пользователя:

1. "food" - ЛОГИРУЕТ прием пищи:
   ✅ "съел овсянку 60г, банан"
   ✅ "завтрак: яйца 2шт, хлеб"
   ✅ "200г курицы, рис 100г"
   ✅ "тарелка супа"
   ✅ "поел", "скушал", "перекусил"
   ❌ "можно ли банан?" (это вопрос!)
   ❌ "что приготовить из курицы?" (вопрос!)
   ❌ "салат" (без контекста - неоднозначно!)

2. "water" - ЛОГИРУЕТ воду:
   ✅ "выпил литр воды"
   ✅ "500 мл", "1л"
   ✅ "стакан воды", "бутылка воды"
   ✅ "попил воды"

3. "question" - ЗАДАЕТ ВОПРОС о питании:
   ✅ "что мне поесть на ужин?"
   ✅ "можно ли банан при похудении?"
   ✅ "дай рецепт с курицей"
   ✅ "сколько калорий в банане?"
   ✅ "какие продукты содержат белок?"
   ✅ "а какой соус лучше?" (продолжение диалога!)
   ✅ ЕСЛИ ЭТО ОТВЕТ НА ВОПРОС АССИСТЕНТА - всегда question!

4. "navigation" - хочет посмотреть данные:
   ✅ "покажи мой дневник"
   ✅ "мой вес", "моя статистика"
   ✅ "сколько я съел сегодня калорий?"

КРИТИЧЕСКИЕ ПРАВИЛА:
🔥 Если в КОНТЕКСТЕ последние 2-3 сообщения - это ДИАЛОГ (вопрос-ответ), то новое сообщение = "question"
🔥 Если есть ВОПРОСИТЕЛЬНЫЕ слова (что, как, когда, можно ли, стоит ли, какой) = "question"
🔥 Если есть ИМПЕРАТИВЫ (дай, покажи, найди, составь, расскажи, предложи) = "question"
🔥 Если есть ГРАММОВКА (60г, 200г, 2шт) + названия продуктов = "food"
🔥 Если ТОЛЬКО названия продуктов БЕЗ контекста (например просто "салат") = needsConfirmation = true
🔥 Если есть глаголы питания (съел, поел, выпил, скушал) = "food"

Верни ТОЛЬКО JSON (без markdown):
{
  "intent": "food" | "water" | "question" | "navigation",
  "confidence": 0.0-1.0,
  "reasoning": "короткое объяснение на русском",
  "needsConfirmation": true | false
}`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 150
      })
    })

    const data = await response.json()

    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid OpenAI response')
    }

    const content = data.choices[0].message.content.trim()
    // Убираем markdown если есть
    const jsonContent = content.replace(/```json\n?|\n?```/g, '').trim()
    const result: IntentResult = JSON.parse(jsonContent)

    console.log('AI Intent Detection:', {
      text,
      result,
      hasContext: history.length > 0
    })

    return result

  } catch (error) {
    console.error('Error in AI intent detection:', error)

    // Fallback на старый метод
    const fallbackIntent = await detectIntent(text)
    return {
      intent: fallbackIntent as any,
      confidence: 0.6,
      reasoning: 'Fallback to regex detection',
      needsConfirmation: false
    }
  }
}

// ============================================
// LEGACY: Старая regex-based детекция (fallback)
// ============================================
async function detectIntent(text: string): Promise<'food' | 'water' | 'question'> {
  const lowerText = text.toLowerCase().trim()

  // 💧 ПРИОРИТЕТ 0: Детекция воды (специфичный case)
  const waterPatterns = [
    /\d+\s*(л|литр|мл|миллилитр)\b/i,  // Цифры с единицами измерения жидкости (word boundary!)
    /(выпил|выпила|попил|попила|пью|пьёт)\s+(вод|жидкост)/i,  // Глаголы питья + вода
    /^\s*(вод|жидкост)/i,  // Начинается с "вода"
    /(стакан|бутылк|кружк|чашк)\s+(вод|жидкост)/i,  // Емкости с водой
    /^\d+\s*(л|литр|мл)\b\s*(вод|жидкост)?/i  // Начинается с количества литров/мл (word boundary!)
  ]

  for (const pattern of waterPatterns) {
    if (pattern.test(lowerText)) {
      // Но проверяем что это не про другую жидкость с калориями (молоко, сок)
      const hasCaloriesDrinks = /(молок|сок|смузи|кефир|йогурт|протеин|коктейл)/i.test(lowerText)
      if (!hasCaloriesDrinks) {
        console.log('Water intake detected:', text)
        return 'water'
      }
    }
  }

  // 🔥 ПРИОРИТЕТ 1: Анафоры и контекстные вопросы (ссылки на предыдущий контекст)
  const anaphoraPatterns = [
    /(про какой|про какую|про какое|про этот|про эту|про то)/i,
    /(что за|какой именно|какая именно|что это за)/i,
    /(расскажи про|детали|подробнее|уточни|объясни)/i,
    /^(этот|эту|это|тот|та|те|какой|какая|какое)\s/i,
    /(а\s+соус|а\s+рецепт|а\s+блюд|а\s+ингредиент)/i
  ]
  
  for (const pattern of anaphoraPatterns) {
    if (pattern.test(lowerText)) {
      console.log('Anaphora/contextual question detected:', text)
      return 'question'
    }
  }
  
  // 🔥 ПРИОРИТЕТ 2: Явные вопросы (вопросительные слова и маркеры)
  const explicitQuestionPatterns = [
    /^(что|как|где|когда|почему|зачем|какой|какая|можно ли|стоит ли)/i,
    /\?$/,
    /(посовет|подскаж|помог|расскаж|объясн|покаж|опиш|детал|распиш)/i,
    /(можно съесть|что поесть|что приготовить|посоветуй|порекомендуй|дай рецепт|найди рецепт|покажи меню|дай рацион|составь рацион)/i,
    /(расскажи|дай|покажи|найди|предложи|составь|сделай|распиши)/i
  ]

  let hasExplicitQuestion = false
  for (const pattern of explicitQuestionPatterns) {
    if (pattern.test(lowerText)) {
      hasExplicitQuestion = true
      break
    }
  }

  if (hasExplicitQuestion) {
    console.log('Explicit question detected:', text)
    return 'question'
  }
  
  // ПРИОРИТЕТ 3: Сильные индикаторы еды (только если НЕТ вопросных маркеров)
  const strongFoodPatterns = [
    /\d+\s*(г|грам|мл|кг|шт)/i,
    /(съел|поел|выпил|скушал|позавтракал|пообедал|поужинал)/i,
    /(завтрак|обед|ужин|перекус):\s/i,
  ]
  
  for (const pattern of strongFoodPatterns) {
    if (pattern.test(lowerText)) {
      console.log('Strong food pattern detected:', text)
      return 'food'
    }
  }
  
  // Слабые индикаторы еды (названия продуктов) - НИЗКИЙ ПРИОРИТЕТ
  const weakFoodPatterns = [
    /(банан|яблок|курица|рис|овсянк|яйц|молок|хлеб|мяс|смузи|протеин|клубник|творог|кефир|йогурт|салат|суп|каш)/i
  ]
  
  let hasFoodWords = false
  for (const pattern of weakFoodPatterns) {
    if (pattern.test(lowerText)) {
      hasFoodWords = true
      break
    }
  }
  
  // Если есть названия продуктов И запятые (перечисление) - это еда
  if (hasFoodWords && lowerText.includes(',') && lowerText.length > 20) {
    console.log('Food products enumeration detected:', text)
    return 'food'
  }
  
  // Если есть названия продуктов И сообщение достаточно длинное (>50 символов) БЕЗ вопросных слов
  if (hasFoodWords && lowerText.length > 50 && !lowerText.includes('?')) {
    // Но проверяем, нет ли глаголов-вопросов
    const hasQuestionVerbs = /(расскаж|покаж|объясн|дай|найди|подскаж)/i.test(lowerText)
    if (!hasQuestionVerbs) {
      console.log('Long message with food products, no question verbs:', text)
      return 'food'
    }
  }
  
  // 🔥 ИЗМЕНЕНО: При сомнении - считаем ВОПРОСОМ (а не едой)
  // Короткие сообщения (<30 символов) с едой - только если есть перечисление
  if (lowerText.length < 30 && !lowerText.includes(',') && hasFoodWords) {
    // Но если есть указательные местоимения - это вопрос
    if (/(этот|тот|про|какой|что)/i.test(lowerText)) {
      console.log('Short message with pointing words - question:', text)
      return 'question'
    }
    console.log('Very short simple food mention:', text)
    return 'food'
  }
  
  // По умолчанию - вопрос (безопаснее)
  console.log('Defaulting to question (low confidence):', text)
  return 'question'
}
async function getUserState(userId: number) {
  const { data, error } = await supabase
    .from('user_states')
    .select('*')
    .eq('telegram_id', userId)
    .maybeSingle()
  
  if (error) {
    console.error('Error getting user state:', error)
    return null
  }
  
  if (data) {
    console.log('User state loaded:', userId, data.state_name, data.state_data)
    return { state: data.state_name, data: data.state_data || {} }
  }
  
  console.log('No state found for user:', userId)
  return null
}
async function setUserState(userId: number, state: string, data: any) {
  console.log('Setting user state:', userId, state, data)
  const { error } = await supabase
    .from('user_states')
    .upsert({
      telegram_id: userId,
      state_name: state,
      state_data: data,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'telegram_id'
    })
  
  if (error) {
    console.error('Error setting user state:', error)
  }
}
async function clearUserState(userId: number) {
  console.log('Clearing user state:', userId)
  await supabase
    .from('user_states')
    .delete()
    .eq('telegram_id', userId)
}

// ============================================
// NUTRITION VALIDATION: Проверка и исправление КБЖУ
// ============================================

interface FoodItem {
  product: string
  weight: string
  calories: number
  protein: number
  fats: number
  carbs: number
}

interface ValidationResult {
  corrected: boolean
  notes: string[]
  calories: number
  protein: number
  fats: number
  carbs: number
  breakdown: FoodItem[]
}

function validateNutrition(analysis: any): ValidationResult {
  const notes: string[] = []
  let corrected = false

  // Константы калорий на 1г макроса
  const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 }

  // Функция для определения категории продукта
  function getCategory(productName: string): string {
    const name = productName.toLowerCase()
    if (name.match(/орех|миндаль|грецк|кешью|арахис|фисташ/)) return 'nuts'
    if (name.match(/творог|йогурт|кефир|молоко|сыр|греч/)) return 'dairy'
    if (name.match(/курица|тунец|рыба|мясо|говяд|свинина/)) return 'protein'
    return 'other'
  }

  // Функция для валидации и исправления одного продукта
  function validateProduct(item: FoodItem): FoodItem {
    const fixed = { ...item }
    const category = getCategory(item.product)

    // Извлекаем вес в граммах
    const weightMatch = item.weight.match(/(\d+(?:\.\d+)?)\s*(?:г|g|грамм)/i)
    if (!weightMatch) return fixed

    const weightG = parseFloat(weightMatch[1])

    // Пересчитываем на 100г для проверки
    const per100 = {
      calories: (item.calories / weightG) * 100,
      protein: (item.protein / weightG) * 100,
      fats: (item.fats / weightG) * 100,
      carbs: (item.carbs / weightG) * 100
    }

    // Проверяем калории по формуле 4-9-4
    const calcKcal = item.protein * KCAL_PER_G.protein +
                     item.fats * KCAL_PER_G.fat +
                     item.carbs * KCAL_PER_G.carb
    const kcalDelta = Math.abs(calcKcal - item.calories) / Math.max(1, item.calories)

    // Категорийные проверки
    if (category === 'nuts') {
      // Орехи: 600-650 ккал/100г, Ж: 50-60г/100г, У: 10-15г/100г
      if (per100.fats < 45 || per100.calories < 500 || per100.carbs > 20) {
        notes.push(`🔧 Исправлены орехи: жиры должны быть ~55г/100г, углеводы ~12г/100г`)
        corrected = true
        // Правильные значения для орехов
        fixed.fats = Math.round((weightG * 55 / 100) * 10) / 10
        fixed.protein = Math.round((weightG * 18 / 100) * 10) / 10
        fixed.carbs = Math.round((weightG * 12 / 100) * 10) / 10
        fixed.calories = Math.round(
          fixed.protein * KCAL_PER_G.protein +
          fixed.fats * KCAL_PER_G.fat +
          fixed.carbs * KCAL_PER_G.carb
        )
      }
    } else if (category === 'dairy') {
      const isLowFatCottage = item.product.match(/творог.*(обезжир|0%)|обезжир.*творог/i)
      const isGreekYogurt = item.product.match(/греч.*йогурт|йогурт.*греч/i)

      if (isLowFatCottage) {
        // Творог обезжиренный: 70-80 ккал/100г, Б: 16-18г/100г
        if (per100.protein < 14 || per100.protein > 20) {
          notes.push(`🔧 Исправлен творог: белок ~17г/100г`)
          corrected = true
          fixed.protein = Math.round((weightG * 17 / 100) * 10) / 10
          fixed.fats = Math.round((weightG * 1 / 100) * 10) / 10
          fixed.carbs = Math.round((weightG * 2.5 / 100) * 10) / 10
          fixed.calories = Math.round(
            fixed.protein * KCAL_PER_G.protein +
            fixed.fats * KCAL_PER_G.fat +
            fixed.carbs * KCAL_PER_G.carb
          )
        }
      } else if (isGreekYogurt) {
        // Греческий йогурт: 60-70 ккал/100г, Б: 10-11г/100г, Ж: 0-2г/100г
        if (per100.fats === 0 && per100.protein > 9) {
          notes.push(`🔧 Добавлен жир для греческого йогурта: минимум 2г/100г`)
          corrected = true
          fixed.fats = Math.round((weightG * 2 / 100) * 10) / 10
          fixed.calories = Math.round(
            fixed.protein * KCAL_PER_G.protein +
            fixed.fats * KCAL_PER_G.fat +
            fixed.carbs * KCAL_PER_G.carb
          )
        }
      }
    }

    // Общая проверка калорий (если дельта > 12%)
    const finalCalcKcal = fixed.protein * KCAL_PER_G.protein +
                          fixed.fats * KCAL_PER_G.fat +
                          fixed.carbs * KCAL_PER_G.carb
    const finalDelta = Math.abs(finalCalcKcal - fixed.calories) / Math.max(1, fixed.calories)

    if (finalDelta > 0.12) {
      notes.push(`🔧 Калории пересчитаны по формуле 4-9-4`)
      corrected = true
      fixed.calories = Math.round(finalCalcKcal)
    }

    return fixed
  }

  // Обрабатываем каждый продукт
  const fixedBreakdown = (analysis.breakdown || []).map(validateProduct)

  // Пересчитываем общие значения
  const totals = fixedBreakdown.reduce((acc, item) => ({
    calories: acc.calories + item.calories,
    protein: acc.protein + item.protein,
    fats: acc.fats + item.fats,
    carbs: acc.carbs + item.carbs
  }), { calories: 0, protein: 0, fats: 0, carbs: 0 })

  // Финальная проверка общих калорий
  const totalCalcKcal = totals.protein * KCAL_PER_G.protein +
                        totals.fats * KCAL_PER_G.fat +
                        totals.carbs * KCAL_PER_G.carb
  const totalDelta = Math.abs(totalCalcKcal - totals.calories) / Math.max(1, totals.calories)

  if (totalDelta > 0.08) {
    notes.push(`🔧 Общие калории пересчитаны по формуле 4-9-4`)
    corrected = true
    totals.calories = Math.round(totalCalcKcal)
  }

  return {
    corrected,
    notes,
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein),
    fats: Math.round(totals.fats),
    carbs: Math.round(totals.carbs),
    breakdown: fixedBreakdown
  }
}

async function saveChatMessage(dbUserId: number, role: 'user' | 'assistant' | 'system', content: string) {
  try {
    const { data, error } = await supabase
      .from('conversation_history')
      .insert({
        user_id: dbUserId,
        role: role,
        content: content
      })
      .select()
    
    if (error) {
      console.error('Error saving chat message:', error)
    }
  } catch (error) {
    console.error('Exception saving chat message:', error)
  }
}
async function getChatHistory(dbUserId: number, limit: number = 10): Promise<Array<{role: string, content: string}>> {
  try {
    const { data, error } = await supabase
      .from('conversation_history')
      .select('role, content')
      .eq('user_id', dbUserId)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (error) {
      console.error('Error getting chat history:', error)
      return []
    }
    
    return data ? data.reverse() : []
  } catch (error) {
    console.error('Exception getting chat history:', error)
    return []
  }
}
async function clearChatHistory(dbUserId: number) {
  try {
    const { error } = await supabase
      .from('conversation_history')
      .delete()
      .eq('user_id', dbUserId)
    
    if (error) {
      console.error('Error clearing chat history:', error)
    }
  } catch (error) {
    console.error('Exception clearing chat history:', error)
  }
}
async function saveUserPreference(
  dbUserId: number,
  preferenceType: 'allergy' | 'intolerance' | 'dislike' | 'exclude' | 'preference',
  item: string,
  description?: string
) {
  try {
    console.log(`🎯 Saving preference for user ${dbUserId}: ${preferenceType} - ${item}`)
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: dbUserId,
        preference_type: preferenceType,
        item: item.toLowerCase(),
        description: description,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,preference_type,item'
      })
      .select()
    
    if (error) {
      console.error('❌ Error saving user preference:', error)
      console.error('Error details:', JSON.stringify(error))
    } else {
      console.log(`✅ Preference saved: ${item}`)
    }
  } catch (error) {
    console.error('❌ Exception saving user preference:', error)
  }
}
async function getUserPreferences(dbUserId: number): Promise<Array<any>> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', dbUserId)
    
    if (error) {
      console.error('Error getting user preferences:', error)
      return []
    }
    
    return data || []
  } catch (error) {
    console.error('Exception getting user preferences:', error)
    return []
  }
}
/**
 * Удалить предпочтение пользователя
 */
async function deleteUserPreference(dbUserId: number, preferenceType: string, item: string) {
  try {
    const { error } = await supabase
      .from('user_preferences')
      .delete()
      .eq('user_id', dbUserId)
      .eq('preference_type', preferenceType)
      .eq('item', item.toLowerCase())
    
    if (error) {
      console.error('Error deleting user preference:', error)
    }
  } catch (error) {
    console.error('Exception deleting user preference:', error)
  }
}
/**
 * Извлечь предпочтения из текста пользователя
 */
async function extractPreferencesFromText(text: string): Promise<Array<{type: string, item: string}>> {
  const preferences: Array<{type: string, item: string}> = []
  
  const lowerText = text.toLowerCase()
  
  // 🚫 НЕ ИЗВЛЕКАТЬ предпочтения из запросов на изменение порций/количества
  const adjustmentKeywords = [
    'увеличь', 'увеличи', 'увеличим', 'больше', 'побольше', 'добавь',
    'уменьши', 'уменьшим', 'меньше', 'поменьше', 'сократи',
    'полцци', 'порци', // опечатки для "порции"
    'количество', 'размер', 'объем'
  ]
  
  for (const keyword of adjustmentKeywords) {
    if (lowerText.includes(keyword)) {
      console.log(`⚠️ Detected adjustment keyword "${keyword}" - skipping preference extraction`)
      return [] // Это запрос на изменение, а не ограничение
    }
  }
  
  // Словари для поиска НАСТОЯЩИХ ограничений
  const intoleranceKeywords = ['непереносимость', 'не переношу', 'не усваивается', 'плохо от']
  const allergyKeywords = ['аллергия', 'аллергичен', 'аллергична']
  const excludeKeywords = ['без', 'не ем', 'не люблю', 'исключить', 'нельзя', 'не хочу', 'замени', 'убери', 'не предлагай', 'вообще не', 'никогда не ем']
  
  // Список продуктов для проверки (более полный)
  const foodItems = [
    { patterns: ['рыб'], item: 'рыба' },
    { patterns: ['лосось', 'семга', 'форель', 'тунец'], item: 'рыба' },
    { patterns: ['мед'], item: 'мед' },
    { patterns: ['авокадо'], item: 'авокадо' },
    { patterns: ['мяс'], item: 'мясо' },
    { patterns: ['свинин'], item: 'свинина' },
    { patterns: ['говядин'], item: 'говядина' },
    { patterns: ['курин', 'курица'], item: 'курица' },
    { patterns: ['индейк'], item: 'индейка' },
    { patterns: ['морепродукт', 'креветк', 'краб', 'моллюск'], item: 'морепродукты' },
    { patterns: ['орех', 'арахис', 'миндаль', 'грецк'], item: 'орехи' },
    { patterns: ['молок'], item: 'молоко' },
    { patterns: ['творог'], item: 'творог' },
    { patterns: ['сыр'], item: 'сыр' },
    { patterns: ['яйц', 'яйко'], item: 'яйца' },
    { patterns: ['грибы', 'гриб'], item: 'грибы' },
    { patterns: ['лактоз'], item: 'лактоза' },
    { patterns: ['глютен'], item: 'глютен' },
    { patterns: ['сахар'], item: 'сахар' },
    { patterns: ['соль'], item: 'соль' },
    { patterns: ['хлеб'], item: 'хлеб' },
    { patterns: ['макарон', 'паста'], item: 'макароны' },
    { patterns: ['рис'], item: 'рис' },
    { patterns: ['картофел', 'картошк'], item: 'картофель' },
    { patterns: ['банан'], item: 'бананы' },
    { patterns: ['молочн'], item: 'молочные продукты' }
  ]
  
  // Проверяем непереносимость
  for (const keyword of intoleranceKeywords) {
    if (lowerText.includes(keyword)) {
      for (const food of foodItems) {
        for (const pattern of food.patterns) {
          if (lowerText.includes(pattern)) {
            preferences.push({type: 'intolerance', item: food.item})
            break
          }
        }
      }
    }
  }
  
  // Проверяем аллергии
  for (const keyword of allergyKeywords) {
    if (lowerText.includes(keyword)) {
      for (const food of foodItems) {
        for (const pattern of food.patterns) {
          if (lowerText.includes(pattern)) {
            preferences.push({type: 'allergy', item: food.item})
            break
          }
        }
      }
    }
  }
  
  // Проверяем исключения
  for (const keyword of excludeKeywords) {
    if (lowerText.includes(keyword)) {
      for (const food of foodItems) {
        for (const pattern of food.patterns) {
          if (lowerText.includes(pattern)) {
            // Специальная обработка: не исключаем творог и сыр если речь о молоке
            if (food.item === 'молоко' && (lowerText.includes('творог') || lowerText.includes('сыр'))) {
              continue
            }
            preferences.push({type: 'exclude', item: food.item})
            break
          }
        }
      }
    }
  }
  
  // Дедупликация - убираем дубликаты
  const uniquePreferences = preferences.filter((pref, index, self) =>
    index === self.findIndex((p) => p.type === pref.type && p.item === pref.item)
  )
  
  return uniquePreferences
}
/**
 * Получить информацию о подписке пользователя
 */
async function getSubscriptionInfo(dbUserId: number): Promise<any> {
  try {
    const { data, error } = await supabase.rpc('get_subscription_info', {
      p_user_id: dbUserId
    })
    
    if (error) {
      console.error('Error getting subscription info:', error)
      return null
    }
    
    return data
  } catch (error) {
    console.error('Exception getting subscription info:', error)
    return null
  }
}
/**
 * Проверка доступа к функциям (есть ли активная подписка)
 */
async function checkSubscriptionAccess(dbUserId: number): Promise<boolean> {
  try {
    const subscriptionData = await getSubscriptionInfo(dbUserId)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    if (!subscriptionInfo) {
      return false
    }
    
    // Проверяем, что подписка активна и не истекла
    if (subscriptionInfo.is_active && subscriptionInfo.expires_at) {
      const expiresAt = new Date(subscriptionInfo.expires_at)
      const now = new Date()
      return expiresAt > now
    }
    
    return false
  } catch (error) {
    console.error('Error checking subscription access:', error)
    return false
  }
}

// ============================================
// RATE LIMITING & CACHE HELPERS
// ============================================

/**
 * Проверка rate limit для пользователя
 */
async function checkRateLimit(dbUserId: number, maxRequests: number = 30, windowMinutes: number = 1): Promise<{allowed: boolean, remaining: number, retryAfter?: number}> {
  try {
    const { data, error } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: dbUserId,
        p_max_requests: maxRequests,
        p_window_minutes: windowMinutes
      })

    if (error) {
      console.error('Error checking rate limit:', error)
      // Если функция не работает - разрешаем запрос (fail open)
      return { allowed: true, remaining: maxRequests }
    }

    return {
      allowed: data.allowed,
      remaining: data.remaining,
      retryAfter: data.retry_after
    }
  } catch (error) {
    console.error('Exception checking rate limit:', error)
    // Fail open
    return { allowed: true, remaining: maxRequests }
  }
}

/**
 * Генерация ключа кеша
 */
function generateCacheKey(type: string, data: any): string {
  // Простой hash - можно улучшить с crypto
  const jsonString = JSON.stringify(data).toLowerCase().trim()
  let hash = 0
  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${type}_${Math.abs(hash)}`
}

/**
 * Получить данные из кеша
 */
async function getFromCache(cacheKey: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_from_cache', {
        p_cache_key: cacheKey
      })

    if (error || !data) {
      return null
    }

    console.log(`✅ Cache HIT for key: ${cacheKey}`)
    return data
  } catch (error) {
    console.error('Error getting from cache:', error)
    return null
  }
}

/**
 * Сохранить данные в кеш
 */
async function saveToCache(
  cacheKey: string,
  cacheType: string,
  requestData: any,
  responseData: any,
  ttlSeconds: number = 2592000 // 30 дней по умолчанию
): Promise<void> {
  try {
    const { error } = await supabase
      .rpc('save_to_cache', {
        p_cache_key: cacheKey,
        p_cache_type: cacheType,
        p_request_data: requestData,
        p_response_data: responseData,
        p_ttl_seconds: ttlSeconds
      })

    if (error) {
      console.error('Error saving to cache:', error)
    } else {
      console.log(`💾 Cache SAVE for key: ${cacheKey}`)
    }
  } catch (error) {
    console.error('Exception saving to cache:', error)
  }
}

/**
 * Fetch с timeout
 */
async function fetchWithTimeout(
  url: string,
  options: any,
  timeout: number = 30000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * OpenAI запрос с retry и timeout
 */
async function callOpenAIWithRetry(
  url: string,
  options: any,
  maxRetries: number = 3,
  timeout: number = 30000
): Promise<any> {
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 OpenAI API call attempt ${attempt}/${maxRetries}`)

      const response = await fetchWithTimeout(url, options, timeout)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      console.log(`✅ OpenAI API call successful`)
      return data

    } catch (error: any) {
      lastError = error
      console.error(`❌ OpenAI API call attempt ${attempt} failed:`, error.message)

      // Если это последняя попытка или ошибка не temporary - бросаем
      if (attempt === maxRetries) {
        throw error
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1)
      console.log(`⏳ Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

// ============================================
// END OF RATE LIMITING & CACHE HELPERS
// ============================================

// ============================================
// PHASE 2: USER CONTEXT OPTIMIZATION
// ============================================

/**
 * Получение полного контекста пользователя одним запросом (PHASE 2 оптимизация)
 * Заменяет 4-5 отдельных запросов на 1 запрос через VIEW
 * @param telegramId - Telegram ID пользователя
 * @returns Полный контекст пользователя или null при ошибке
 */
async function getUserFullContext(telegramId: number): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_user_full_context', { p_telegram_id: telegramId })

    if (error) {
      console.error('❌ Error getting user full context:', error)
      return null
    }

    if (!data) {
      console.warn('⚠️ No context found for telegram_id:', telegramId)
      return null
    }

    console.log(`✅ Got user full context for ${telegramId} (user_id: ${data.user?.id})`)
    return data
  } catch (error) {
    console.error('❌ Exception in getUserFullContext:', error)
    return null
  }
}

/**
 * Получение полного контекста пользователя по user_id (PHASE 2 оптимизация)
 * @param userId - Internal user_id из БД
 * @returns Полный контекст пользователя или null при ошибке
 */
async function getUserFullContextById(userId: number): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_user_full_context_by_id', { p_user_id: userId })

    if (error) {
      console.error('❌ Error getting user full context by id:', error)
      return null
    }

    if (!data) {
      console.warn('⚠️ No context found for user_id:', userId)
      return null
    }

    console.log(`✅ Got user full context for user_id ${userId}`)
    return data
  } catch (error) {
    console.error('❌ Exception in getUserFullContextById:', error)
    return null
  }
}

// ============================================
// END OF USER CONTEXT OPTIMIZATION
// ============================================

/**
 * Отправка сообщения в Telegram
 */
async function sendMessage(chatId: number, text: string, replyMarkup?: any, parseMode: string = 'Markdown', replyToMessageId?: number): Promise<any> {
  const payload: any = {
    chat_id: chatId,
    text: text
  }

  if (parseMode) {
    payload.parse_mode = parseMode
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }

  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId
  }
  
  console.log('Sending message to chat:', chatId, 'length:', text.length, 'parse_mode:', parseMode)
  
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    const result = await response.json()
    
    if (!response.ok) {
      console.error('Telegram API error:', result)
      console.error('Message text:', text.substring(0, 200))
      
      // Если ошибка парсинга Markdown, попробуем без форматирования
      if (result.description?.includes("can't parse entities") && parseMode) {
        console.log('Retrying without parse_mode...')
        return await sendMessage(chatId, text, replyMarkup, '')
      }
      
      throw new Error(`Telegram API error: ${result.description}`)
    }
    
    console.log('Message sent successfully')
    return result
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}
/**
 * Ответ на callback query
 */
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text || ''
    })
  })
}
/**
 * Редактирование сообщения
 */
async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any
): Promise<any> {
  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'Markdown'
  }
  
  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }
  
  const response = await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  
  return await response.json()
}
/**
 * Получить или создать пользователя
 */
async function getOrCreateUser(telegramId: number, username?: string, firstName?: string) {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()
  
  if (existing) return existing
  
  const { data: newUser } = await supabase
    .from('users')
    .insert({
      telegram_id: telegramId,
      username: username,
      first_name: firstName
    })
    .select()
    .single()
  
  return newUser
}
/**
 * Генерация плана КБЖУ через OpenAI
 */
async function generateNutritionPlan(profileData: any): Promise<any> {
  const activityNames = {
    low: 'маленькая (не тренируюсь вообще)',
    medium: 'средняя (тренируюсь 1-2 раза в неделю)',
    high: 'высокая (тренируюсь 3 и более раз в неделю)'
  }
  
  const goalNames = {
    lose: 'сбросить вес',
    maintain: 'держать вес',
    gain: 'набор веса'
  }
  const prompt = `Ты - профессиональный диетолог C.I.D. (Care • Insight • Discipline). Рассчитай КБЖУ для клиента.
Данные клиента:
- Имя: ${profileData.name}
- Возраст: ${profileData.age} лет
- Пол: ${profileData.gender === 'male' ? 'мужской' : 'женский'}
- Рост: ${profileData.height} см
- Текущий вес: ${profileData.current_weight} кг
- Активность: ${activityNames[profileData.activity_level as keyof typeof activityNames]}
- Цель: ${goalNames[profileData.goal as keyof typeof goalNames]}
${profileData.wishes ? `- Пожелания клиента: "${profileData.wishes}"` : ''}
Выполни следующее:
1. Рассчитай базовый метаболизм (BMR) используя формулу Миффлина-Сан Жеора
2. Рассчитай общий расход калорий (TDEE) с учетом активности
3. Определи целевую калорийность в зависимости от цели
4. Рассчитай оптимальное распределение БЖУ
5. Рассчитай норму воды в день (обычно 30-40 мл на кг веса)
6. Дай рекомендации по активности
7. ОБЯЗАТЕЛЬНО учти пожелания клиента в рекомендациях
Верни результат СТРОГО в формате JSON:
{
    "bmr": число,
    "tdee": число,
    "target_calories": число,
    "protein_grams": число,
    "fats_grams": число,
    "carbs_grams": число,
    "water_liters": число,
    "methodology_explanation": "подробное объяснение расчетов и методики",
    "activity_recommendations": "рекомендации по активности с учетом пожеланий клиента"
}`
  console.log('Calling OpenAI API for nutrition plan...')
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
          {
            role: 'system',
            content: 'Ты C.I.D. - опытный диетолог и тренер. Всегда отвечай на русском языке в формате JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_completion_tokens: 1000
      })
    })
    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      throw new Error(`OpenAI API error: ${response.status}`)
    }
    const data = await response.json()
    console.log('OpenAI response received')
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid OpenAI response:', data)
      throw new Error('Invalid OpenAI response')
    }
    
    return JSON.parse(data.choices[0].message.content)
  } catch (error) {
    console.error('Error in generateNutritionPlan:', error)
    throw error
  }
}
async function adjustNutritionPlan(currentPlan: any, userRequest: string, profileData: any): Promise<any> {
  const prompt = `Ты C.I.D., диетолог. Клиент хочет скорректировать план.
Текущий план: ${currentPlan.calories} ккал, ${currentPlan.protein}г белка, ${currentPlan.fats}г жиров, ${currentPlan.carbs}г углеводов, ${currentPlan.water}л воды
Данные: ${profileData.name}, ${profileData.age} лет, ${profileData.gender === 'male' ? 'мужской' : 'женский'}, ${profileData.current_weight} кг
Запрос: "${userRequest}"
Верни JSON: {"target_calories": число, "protein_grams": число, "fats_grams": число, "carbs_grams": число, "water_liters": число, "adjustment_explanation": "объяснение"}`
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: 'Ты C.I.D. - диетолог. Корректируй планы питания безопасно.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_completion_tokens: 500
    })
  })
  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}
/**
 * Очистка текста от Markdown разметки
 */
function cleanMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/\*\*/g, '')      // Убираем **
    .replace(/\*/g, '')        // Убираем *
    .replace(/__/g, '')        // Убираем __
    .replace(/_/g, '')         // Убираем _
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')  // Убираем ссылки [текст](url) -> текст
    .replace(/`([^`]+)`/g, '$1')  // Убираем код `текст` -> текст
    .replace(/#{1,6}\s/g, '')  // Убираем заголовки
    .trim()
}
/**
 * Форматирование карточки КБЖУ (БЕЗ Markdown)
 */
function formatNutritionCard(plan: any, profileData: any): string {
  const name = profileData.name || 'Клиент'
  const calories = plan.target_calories || plan.calories || 0
  const protein = plan.protein_grams || plan.protein || 0
  const fats = plan.fats_grams || plan.fats || 0
  const carbs = plan.carbs_grams || plan.carbs || 0
  const water = plan.water_liters || plan.water || 2
  const bmr = plan.bmr || 0
  const tdee = plan.tdee || 0
  
  // Очищаем текст от Markdown разметки
  const methodology = cleanMarkdown(plan.methodology_explanation || '')
  const recommendations = cleanMarkdown(plan.activity_recommendations || 'Следуйте вашей текущей программе тренировок')
  
  return `📊 КАРТОЧКА КБЖУ ДЛЯ ${name.toUpperCase()}
🔥 Калории: ${calories} ккал/день
🥩 Белки: ${protein} г
🥑 Жиры: ${fats} г
🍞 Углеводы: ${carbs} г
💧 Вода: ${water} л/день
📈 Метаболизм:
• Базовый (BMR): ${bmr.toFixed(0)} ккал/день
• Общий расход (TDEE): ${tdee.toFixed(0)} ккал/день
${methodology}
💪 Рекомендации по активности:
${recommendations}
`
}
/**
 * Клавиатура приветствия
 */
function welcomeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✨ Заполнить профиль", callback_data: "fill_profile" }]
    ]
  }
}
/**
 * Клавиатура для карточки КБЖУ
 */
function nutritionCardKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Готово", callback_data: "card_done" },
        { text: "✏️ Редактировать", callback_data: "edit_profile" }
      ],
      [
        { text: "🔄 Скорректировать", callback_data: "adjust_card" }
      ]
    ]
  }
}
/**
 * Главное меню (реплай клавиатура)
 */
function getMainKeyboard() {
  return {
    keyboard: [
      [
        { text: "📊 Дневник" },
        { text: "📖 Рецепты" }
      ],
      [
        { text: "👤 Профиль" },
        { text: "❓ Помощь" }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
}
/**
 * Меню дневника
 */
function getDiaryKeyboard() {
  return {
    keyboard: [
      [
        { text: "📊 КБЖУ + Вода" }
      ],
      [
        { text: "📝 Мои приемы пищи" }
      ],
      [
        { text: "🔙 Назад" }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
}
/**
 * Меню настроек
 */
function getSettingsKeyboard() {
  return {
    keyboard: [
      [
        { text: "💎 Подписка" },
        { text: "👤 Профиль" }
      ],
      [
        { text: "🎯 Мои предпочтения" }
      ],
      [
        { text: "🔙 Назад" }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
}
/**
 * Клавиатура выбора пола
 */
function genderKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👨 Мужской", callback_data: "gender_male" },
        { text: "👩 Женский", callback_data: "gender_female" }
      ]
    ]
  }
}
/**
 * Клавиатура выбора активности
 */
function activityKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🪑 Маленькая (Не тренируюсь вообще)", callback_data: "activity_low" }],
      [{ text: "🚶 Средняя (1-2 раза в неделю)", callback_data: "activity_medium" }],
      [{ text: "💪 Высокая (3+ раза в неделю)", callback_data: "activity_high" }]
    ]
  }
}
/**
 * Клавиатура выбора цели
 */
function goalKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📉 Сбросить вес", callback_data: "goal_lose" }],
      [{ text: "⚖️ Держать вес", callback_data: "goal_maintain" }],
      [{ text: "📈 Набрать вес", callback_data: "goal_gain" }]
    ]
  }
}

/**
 * 🔥 НОВЫЕ ОПТИМИЗИРОВАННЫЕ КЛАВИАТУРЫ
 */

/**
 * Быстрый выбор объема воды (inline)
 */
function quickWaterKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "250 мл", callback_data: "log_water_250" },
        { text: "500 мл", callback_data: "log_water_500" }
      ],
      [
        { text: "1 л", callback_data: "log_water_1000" },
        { text: "✏️ Другое", callback_data: "log_water_custom" }
      ],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  }
}

/**
 * Меню "Настройки"
 */
function settingsMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👤 Профиль (КБЖУ)", callback_data: "show_profile" }
      ],
      [
        { text: "📈 Прогресс", callback_data: "progress_menu" }
      ],
      [
        { text: "💎 Подписка", callback_data: "show_subscription" }
      ],
      [
        { text: "🎯 Предпочтения", callback_data: "show_preferences" }
      ],
      [
        { text: "🔔 Уведомления", callback_data: "notifications_menu" }
      ],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  }
}

/**
 * Меню "Моё меню"
 */
function myMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🍽 Мои шаблоны", callback_data: "my_templates" }
      ],
      [
        { text: "📖 Мои рецепты", callback_data: "my_recipes" }
      ],
      [
        { text: "🛒 Список покупок", callback_data: "shopping_menu" }
      ],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  }
}

/**
 * Клавиатура действий после ответа AI с рецептом/рационом
 */
function aiResponseActionsKeyboard(hasMultipleItems: boolean = false) {
  const keyboard: any[][] = []

  if (hasMultipleItems) {
    // Если AI предложил рацион (несколько блюд)
    keyboard.push([
      { text: "📖 Сохранить рацион", callback_data: "save_ai_meal_plan" }
    ])
    keyboard.push([
      { text: "💾 Сохранить по отдельности", callback_data: "save_ai_items_separately" }
    ])
  } else {
    // Если AI предложил один рецепт
    keyboard.push([
      { text: "📖 Сохранить рецепт", callback_data: "save_ai_recipe" }
    ])
  }

  keyboard.push([
    { text: "🍽 Записать как прием", callback_data: "log_ai_as_meal" }
  ])

  keyboard.push([
    { text: "🏠 Главное меню", callback_data: "main_menu" }
  ])

  return { inline_keyboard: keyboard }
}

/**
 * Контекстные действия после записи еды
 */
function afterFoodLogKeyboard(mealId?: number) {
  const keyboard: any[][] = [
    [
      { text: "🍽 Еще прием", callback_data: "quick_log_food" },
      { text: "📊 Мой день", callback_data: "diary" }
    ]
  ]

  // Добавляем кнопки редактирования если есть ID приема
  if (mealId) {
    keyboard.push([
      { text: "⭐ В избранное", callback_data: `save_template_${mealId}` },
      { text: "✏️ Изменить", callback_data: `edit_meal_${mealId}` }
    ])
    keyboard.push([
      { text: "🗑 Удалить", callback_data: `delete_meal_${mealId}` }
    ])
  }

  keyboard.push([{ text: "🏠 Главное меню", callback_data: "main_menu" }])

  return { inline_keyboard: keyboard }
}

/**
 * Inline меню для "Мой день" с быстрыми действиями
 */
function myDayActionsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📝 Мои приемы", callback_data: "manage_meals" },
        { text: "⚡ Быстрый лог", callback_data: "quick_log" }
      ],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  }
}

/**
 * Обработка команды /start
 */
async function handleStartCommand(message: TelegramMessage) {
  const user = await getOrCreateUser(
    message.from.id,
    message.from.username,
    message.from.first_name
  )
  
  // Проверяем профиль
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
  
  // Если профиля нет - показываем приветствие
  if (!profile) {
    const welcomeMessage = `👋 **Привет, ${message.from.first_name}!** Я C.I.D. — Care • Insight • Discipline.
Твой AI-наставник по питанию и привычкам.
Я помогу тебе рассчитать рацион, вести учёт и не терять фокус.
🎯 **Что я умею:**
📊 Рассчитываю персональный КБЖУ на основе твоих данных (возраст, вес, рост, активность, цели) по научной методике Миффлина-Сан Жеора
🍽️ Помогаю записывать приемы пищи текстом или голосом. AI анализирует блюда и показывает детализацию по продуктам
📋 Даю рекомендации по рецептам с учетом остатка дневного КБЖУ, предупреждаю о переедании, планирую меню на день/неделю
📊 Веду дневник питания с визуализацией прогресса, статистикой воды и историей корректировок
🎤 Поддерживаю голосовой ввод везде - наговаривай вместо печати
📸 Распознавание по фото - сфотографируй еду - я автоматически распознаю продукты и рассчитаю КБЖУ 
✏️ Гибко настраиваю план питания через AI, учитываю твои пожелания и даю персональные советы
Готов начать? 🚀`
    
    await sendMessage(message.chat.id, welcomeMessage, welcomeKeyboard())
    return
  }
  
  // Если профиль есть - показываем статистику за сегодня
  const { data: plan } = await supabase
    .from('nutrition_plans')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()
  
  if (!plan) {
    await sendMessage(message.chat.id, `👋 **Привет, ${profile.name || message.from.first_name}!**\n\n✅ Твой профиль создан, но план КБЖУ еще не рассчитан.\n\nИспользуй меню для создания плана.`, getMainKeyboard())
    return
  }
  
  // Получаем статистику за сегодня
  const today = new Date().toISOString().split('T')[0]
  const { data: todayLogs } = await supabase
    .from('food_logs')
    .select('*')
    .eq('user_id', user.id)
    .gte('logged_at', `${today}T00:00:00`)
  
  // Считаем съеденное
  const consumed = todayLogs?.reduce((acc, log) => ({
    calories: acc.calories + (log.calories || 0),
    protein: acc.protein + (log.protein || 0),
    fats: acc.fats + (log.fats || 0),
    carbs: acc.carbs + (log.carbs || 0)
  }), { calories: 0, protein: 0, fats: 0, carbs: 0 }) || { calories: 0, protein: 0, fats: 0, carbs: 0 }
  
  const remaining = {
    calories: plan.calories - consumed.calories,
    protein: plan.protein - consumed.protein,
    fats: plan.fats - consumed.fats,
    carbs: plan.carbs - consumed.carbs
  }
  
  // Определяем эмодзи для баланса
  const balanceEmoji = remaining.calories > 0 ? '💚' : remaining.calories < 0 ? '❤️' : '💛'
  const balanceSign = remaining.calories > 0 ? '+' : ''
  
  // Inline keyboard с quick actions
  const keyboard = {
    inline_keyboard: [
      [
        { text: "💸 Быстрая запись", callback_data: "quick_log_food" },
        { text: "📋 Рецепты", callback_data: "menu_recipes" }
      ],
      [
        { text: "📊 Подробная статистика", callback_data: "diary" }
      ]
    ]
  }
  
  await sendMessage(
    message.chat.id,
    `👋 **Привет, ${profile.name || message.from.first_name}!**\n\n` +
    `📊 **Прогресс за сегодня:**\n` +
    `${balanceEmoji} **${balanceSign}${remaining.calories.toFixed(0)} ккал** (осталось)\n\n` +
    `🥩 Белки: ${consumed.protein.toFixed(0)}/${Math.round(plan.protein)}г\n` +
    `🥑 Жиры: ${consumed.fats.toFixed(0)}/${Math.round(plan.fats)}г\n` +
    `🍞 Углеводы: ${consumed.carbs.toFixed(0)}/${Math.round(plan.carbs)}г\n\n` +
    `💡 **Совет:** Можешь записывать еду текстом, голосом или 📸 фотографией!\n\n` +
    `Используй кнопки меню для управления питанием 👇`,
    keyboard
  )
  
  // Отправляем главное меню отдельным сообщением
  await sendMessage(message.chat.id, "🏠 **Главное меню**", getMainKeyboard())
}
/**
 * Обработка callback query
 */
async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery) {
  await answerCallbackQuery(callbackQuery.id)
  
  const chatId = callbackQuery.message!.chat.id
  const messageId = callbackQuery.message!.message_id
  const data = callbackQuery.data!
  const userId = callbackQuery.from.id
  
  // Получаем пользователя из БД
  const user = await getOrCreateUser(
    callbackQuery.from.id,
    callbackQuery.from.username,
    callbackQuery.from.first_name
  )
  
  // БЛОКИРОВКА: Проверяем подписку (кроме действий связанных с оплатой и регистрацией)
  const allowedActions = ['fill_profile', 'buy_subscription', 'show_profile', 'gender_', 'activity_', 'goal_'];
  const isAllowed = allowedActions.some(action => data.startsWith(action)) || data.startsWith('select_plan_');
  
  if (!isAllowed) {
    const subscriptionData = await getSubscriptionInfo(user.id)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    // Если подписка истекла и это не unlimited
    if (subscriptionInfo && subscriptionInfo.needs_payment && !subscriptionInfo.is_unlimited) {
      const blockMessage = `⏰ **Пробный период истек**\n\n` +
        `😔 К сожалению, твой 7-дневный пробный период подошел к концу.\n\n` +
        `💎 **Продолжи пользоваться C.I.D.** — выбери подходящий тариф:\n\n` +
        `⚡ **1 месяц** — 129₽ (Попробовать)\n` +
        `🔥 **6 месяцев** — 649₽ (Популярный)\n` +
        `💎 **1 год** — 1099₽ (Выгодно!)\n\n` +
        `🔒 Безопасная оплата через T-Bank\n` +
        `✨ Подписка активируется моментально`
      
      await sendMessage(chatId, blockMessage, {
        inline_keyboard: [
          [{ text: "💳 Оформить подписку", callback_data: "buy_subscription" }],
          [{ text: "👤 Мой профиль", callback_data: "show_profile" }]
        ]
      })
      return // Блокируем дальнейшую обработку
    }
  }
  
  // Начало заполнения профиля
  if (data === 'fill_profile') {
    await setUserState(userId, 'waiting_name', {})
    await editMessageText(
      chatId,
      messageId,
      "✨ Отлично! Давай познакомимся.\n\n📝 Как тебя зовут?"
    )
  }
  
  // Выбор пола
  else if (data.startsWith('gender_')) {
    const gender = data.split('_')[1]
    const stateData = await getUserState(userId)
    if (stateData) {
      stateData.data.gender = gender
      stateData.state = 'waiting_age'
      await setUserState(userId, stateData.state, stateData.data)
      await sendMessage(chatId, "🎂 Сколько тебе лет?")
    } else {
      // Если состояния нет, создаем заново
      await setUserState(userId, 'waiting_age', { gender })
      await sendMessage(chatId, "🎂 Сколько тебе лет?")
    }
  }
  
  // Выбор активности
  else if (data.startsWith('activity_')) {
    const activity = data.split('_')[1]
    const stateData = await getUserState(userId)
    if (stateData) {
      stateData.data.activity_level = activity
      stateData.state = 'waiting_goal'
      await setUserState(userId, stateData.state, stateData.data)
      await sendMessage(chatId, "🎯 Какая у тебя цель?", goalKeyboard())
    } else {
      // Если состояния нет, создаем заново
      await setUserState(userId, 'waiting_goal', { activity_level: activity })
      await sendMessage(chatId, "🎯 Какая у тебя цель?", goalKeyboard())
    }
  }
  
  // Выбор цели
  else if (data.startsWith('goal_')) {
    const goal = data.split('_')[1]
    const stateData = await getUserState(userId)
    if (stateData) {
      stateData.data.goal = goal
      stateData.state = 'waiting_wishes'
      await setUserState(userId, stateData.state, stateData.data)
      await sendMessage(
        chatId,
        `💭 **Пожелания:**\n\nОпиши свои цели подробнее.\nНапример: "хочу стать рельефным" или "хочу стать сильнее"\n\nМожешь написать текстом или отправить голосовое сообщение.`
      )
    } else {
      // Если состояния нет, создаем заново
      await setUserState(userId, 'waiting_wishes', { goal })
      await sendMessage(
        chatId,
        `💭 **Пожелания:**\n\nОпиши свои цели подробнее.\nНапример: "хочу стать рельефным" или "хочу стать сильнее"\n\nМожешь написать текстом или отправить голосовое сообщение.`
      )
    }
  }
  
  // Показать карточку
  else if (data === 'show_card') {
    // ⚡ PHASE 2 OPTIMIZATION: 1 запрос вместо 2
    const context = await getUserFullContextById(user.id)

    if (context?.plan && context?.profile) {
      const cardText = formatNutritionCard(context.plan, context.profile)
      await editMessageText(chatId, messageId, cardText, nutritionCardKeyboard())
    } else {
      await editMessageText(chatId, messageId, "⚠️ План еще не создан. Заполни профиль!")
    }
  }
  
  // Корректировка карточки
  else if (data === 'adjust_card') {
    await setUserState(userId, 'waiting_adjustment', {})
    await editMessageText(
      chatId,
      messageId,
      `🔄 **Корректировка плана**\n\nВы можете написать или наговорить голосовым сообщением ваши рекомендации, и я пересчитаю карточку.\n\nНапример:\n• "Увеличь белок на 20 грамм"\n• "Хочу больше воды"\n• "Снизь углеводы до 150 грамм"`
    )
  }
  
  // Готово
  else if (data === 'card_done') {
    const welcomeText = `✅ Отлично! Старт положен и ты уже начал путь к своей цели!
"Путь в тысячу миль начинается с первого шага!"
💡 Все параметры рассчитаны с помощью ИИ и максимально приближены к реальности, но помни — это ориентиры для старта. Слушай своё тело и корректируй план по мере необходимости.`
    
    await sendMessage(chatId, welcomeText)
    
    // Показываем информацию о trial подписке
    const subscriptionData = await getSubscriptionInfo(user.id)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    if (subscriptionInfo && subscriptionInfo.is_trial) {
      const daysLeft = Math.ceil((new Date(subscriptionInfo.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      
      const trialMessage = `🎁 **Пробный период активирован!**\n\n` +
        `⏰ **${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}** бесплатного доступа\n\n` +
        `💡 **Сейчас ничего платить не нужно!**\n` +
        `Никаких данных карт, никаких автоплатежей.\n\n` +
        `✨ Пользуйся **всеми функциями** бота совершенно бесплатно.\n\n` +
        `📅 После ${daysLeft} ${daysLeft === 1 ? 'дня' : daysLeft < 5 ? 'дней' : 'дней'} сможешь продолжить за:\n` +
        `• 1 месяц — 129₽\n` +
        `• 6 месяцев — 649₽ (выгодно!)\n` +
        `• 1 год — 1099₽ (супер выгодно!)\n\n` +
        `🚀 Начинай прямо сейчас!`
      
      await sendMessage(chatId, trialMessage, {
        inline_keyboard: [
          [{ text: "🚀 Начать пользоваться", callback_data: "start_onboarding" }]
        ]
      })
    } else {
      // Если подписка не trial (например, админ дал unlimited) - просто показываем меню
      await sendMessage(chatId, "🏠 **Главное меню**", getMainKeyboard())
    }
  }
  
  // Редактировать профиль
  else if (data === 'edit_profile') {
    await sendMessage(
      chatId,
      "✏️ Что хочешь изменить?",
      {
        inline_keyboard: [
          [{ text: "📊 КБЖУ + Вода", callback_data: "edit_nutrition" }],
          [{ text: "👤 Параметры профиля", callback_data: "edit_parameters" }]
        ]
      }
    )
  }
  
  // Редактирование КБЖУ
  else if (data === 'edit_nutrition') {
    await sendMessage(
      chatId,
      "📊 Что конкретно хочешь изменить в КБЖУ?",
      {
        inline_keyboard: [
          [{ text: "🔥 Калории", callback_data: "edit_calories" }],
          [{ text: "🥩 Белки", callback_data: "edit_protein" }],
          [{ text: "🥑 Жиры", callback_data: "edit_fats" }],
          [{ text: "🍞 Углеводы", callback_data: "edit_carbs" }],
          [{ text: "💧 Вода", callback_data: "edit_water" }]
        ]
      }
    )
  }
  
  // Редактирование параметров профиля
  else if (data === 'edit_parameters') {
    await sendMessage(
      chatId,
      "👤 Какой параметр хочешь изменить?",
      {
        inline_keyboard: [
          [{ text: "📝 Имя", callback_data: "edit_name" }],
          [{ text: "⚖️ Вес", callback_data: "edit_weight" }],
          [{ text: "📏 Рост", callback_data: "edit_height" }],
          [{ text: "🎂 Возраст", callback_data: "edit_age" }]
        ]
      }
    )
  }
  
  // Обработка выбора конкретного параметра КБЖУ
  else if (data.startsWith('edit_')) {
    const param = data.split('_')[1]
    const paramNames: { [key: string]: string } = {
      calories: 'калории',
      protein: 'белки',
      fats: 'жиры',
      carbs: 'углеводы',
      water: 'воду',
      name: 'имя',
      weight: 'вес',
      height: 'рост',
      age: 'возраст'
    }
    
    const paramName = paramNames[param] || param
    
    await setUserState(userId, `editing_${param}`, {})
    await sendMessage(
      chatId,
      `📝 Введи новое значение для ${paramName}:`
    )
  }
  
  // Записать прием пищи
  else if (data === 'log_food') {
    await setUserState(userId, 'logging_food', {})
    await sendMessage(
      chatId,
      `🍽 **Запись приема пищи**
Напиши или наговори, что ты поел/выпил.
💡 **Для точности:** укажи каждый продукт с граммовкой.
📝 **Важно:** крупы взвешиваем в сухом виде, мясо — в готовом.
Можешь написать примерно: "тарелка супа" или "рис с мясом" — я уточню детали.`,
      {
        inline_keyboard: [
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }
  
  // Меню рецептов
  else if (data === 'menu_recipes') {
    await setUserState(userId, 'requesting_recipe', {})
    await sendMessage(
      chatId,
      `💬 **Режим диалога активирован**
Привет! Я твой AI-диетолог. Теперь все твои сообщения будут обрабатываться как вопросы о питании.
✨ **Что я могу:**
• Предложить рецепты с учетом КБЖУ
• Составить меню на день/неделю
• Дать совет по питанию
• Помочь с выбором продуктов
📝 **Записать еду?** Нажми "Главное меню" и просто напиши что съел в чат.
Задавай вопросы! 😊`,
      {
        inline_keyboard: [
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }
  
  // Дневник
  else if (data === 'diary') {
    await showDiary(chatId, user.id)
  }
  
  // Онбординг для новых пользователей
  else if (data === 'start_onboarding') {
    await startOnboarding(chatId, userId)
  }
  
  // Шаги онбординга
  else if (data === 'onboarding_step_2') {
    await onboardingStep2(chatId, userId)
  }
  else if (data === 'onboarding_step_3') {
    await onboardingStep3(chatId, userId)
  }
  else if (data === 'onboarding_step_4') {
    await onboardingStep4(chatId, userId)
  }
  else if (data === 'onboarding_step_5') {
    await onboardingStep5(chatId, userId)
  }
  else if (data === 'onboarding_step_6') {
    await onboardingStep6(chatId, userId)
  }
  
  // Подтверждение записи из фото
  else if (data.startsWith('confirm_photo_')) {
    const stateData = await getUserState(userId)
    if (stateData?.state === 'photo_analysis_pending' && stateData.data?.analysis) {
      const analysis = stateData.data.analysis
      
      // Формируем описание для записи
      const foodDescription = analysis.items.map((item: any) => 
        `${item.name} ${item.weight}г`
      ).join(', ')
      
      // Записываем в базу
      const { error } = await supabase
        .from('food_logs')
        .insert({
          user_id: user.id,
          description: foodDescription,
          calories: analysis.total.calories,
          protein: analysis.total.protein,
          fats: analysis.total.fats,
          carbs: analysis.total.carbs,
          created_at: new Date().toISOString()
        })
      
      if (error) {
        console.error('Error saving photo meal:', error)
        await sendMessage(chatId, "❌ Ошибка сохранения. Попробуй еще раз.")
        return
      }

      // 🔥 STREAK SYSTEM: Обновляем streak пользователя
      let streakInfo: any = null
      try {
        const { data: streakData, error: streakError } = await supabase
          .rpc('update_user_streak', { p_user_id: user.id })
          .single()

        if (!streakError && streakData) {
          streakInfo = streakData
          console.log(`✅ Streak updated for user ${user.id}:`, streakInfo)
        }
      } catch (error) {
        console.error('Error updating streak:', error)
      }

      // Формируем streak информацию
      let streakText = ''
      if (streakInfo) {
        streakText = `\n\n🔥 **Streak: ${streakInfo.current_streak} ${streakInfo.current_streak === 1 ? 'день' : streakInfo.current_streak < 5 ? 'дня' : 'дней'}!**`
        if (streakInfo.is_new_record) {
          streakText += ` 🎉 Новый рекорд!`
        }
        if (streakInfo.earned_achievements && streakInfo.earned_achievements.length > 0) {
          streakText += `\n\n🏆 **Новые достижения:**\n${streakInfo.earned_achievements.join('\n')}`
        }
      }

      await clearUserState(userId)
      await sendMessage(
        chatId,
        `✅ **Прием пищи записан!**\n\n` +
        `📝 ${foodDescription}\n\n` +
        `🔥 Калории: ${analysis.total.calories} ккал\n` +
        `🥩 Белки: ${analysis.total.protein}г\n` +
        `🧈 Жиры: ${analysis.total.fats}г\n` +
        `🍞 Углеводы: ${analysis.total.carbs}г` +
        `${streakText}\n\n` +
        `⚠️ Помни: это примерная оценка!`,
        afterFoodLogKeyboard()
      )
    } else {
      await sendMessage(chatId, "❌ Данные анализа не найдены. Отправь фото заново.")
    }
  }
  
  // Главное меню
  else if (data === 'main_menu') {
    await clearUserState(userId) // Очищаем любое активное состояние
    await sendMessage(chatId, "🏠 **Главное меню**", getMainKeyboard())
  }
  
  // Меню уведомлений
  else if (data === 'notifications_menu') {
    await showNotificationsMenu(chatId, user.id)
  }
  
  // Переключение уведомлений о еде
  else if (data === 'toggle_food_notifications') {
    await toggleNotifications(chatId, user.id, 'food')
  }
  
  // Переключение уведомлений о воде
  else if (data === 'toggle_water_notifications') {
    await toggleNotifications(chatId, user.id, 'water')
  }
  
  // Поддержать проект (донат)
  else if (data === 'support_project') {
    await showDonationOptions(chatId, userId)
  }
  
  // Выбор суммы доната
  else if (data.startsWith('donate_')) {
    const amount = parseInt(data.split('_')[1])
    await createDonationPayment(chatId, user.id, amount)
  }
  
  // Кастомная сумма доната
  else if (data === 'donate_custom') {
    await setUserState(userId, 'entering_donation_amount', {})
    await sendMessage(
      chatId,
      `💝 **Поддержать проект**\n\n` +
      `Введи сумму, которую хочешь поддержать проект (от 50₽ до 10000₽):\n\n` +
      `Например: 500`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "support_project" }]
        ]
      }
    )
  }
  
  // Купить подписку
  else if (data === 'buy_subscription') {
    // Получаем только платные планы (monthly, quarterly, yearly)
    const { data: plans } = await supabase
      .from('subscription_plans')
      .select('*')
      .in('name', ['monthly', 'quarterly', 'yearly'])
      .order('duration_days', { ascending: true })
    
    if (!plans || plans.length === 0) {
      await sendMessage(chatId, "❌ Планы подписки недоступны. Обратитесь к администратору.")
      return
    }
    
    let message = `💎 **Оформление подписки C.I.D.**\n\n`
    message += `Выбери подходящий тариф:\n\n`
    
    const keyboard: any[] = []
    
    // Emoji для каждого плана
    const planEmoji: Record<string, string> = {
      'monthly': '⚡',
      'quarterly': '🔥',
      'yearly': '💎'
    }
    
    for (const plan of plans) {
      const priceRub = plan.price_rub || 0
      const emoji = planEmoji[plan.name] || '✨'
      
      let durationText = ''
      let description = ''
      
      if (plan.name === 'monthly') {
        durationText = '1 месяц'
        description = 'Попробовать'
      } else if (plan.name === 'quarterly') {
        durationText = '6 месяцев'
        description = 'Популярный'
      } else if (plan.name === 'yearly') {
        durationText = '1 год'
        description = 'Выгодно!'
      }
      
      message += `${emoji} **${durationText}** — ${priceRub}₽ (${description})\n`
      keyboard.push([{ 
        text: `${emoji} ${durationText} — ${priceRub}₽`, 
        callback_data: `select_plan_${plan.id}` 
      }])
    }
    
    message += `\n🔒 **Безопасная оплата через T-Bank**\n`
    message += `✨ Подписка активируется моментально после оплаты`
    
    keyboard.push([{ text: "🔙 Назад", callback_data: "show_profile" }])
    
    await sendMessage(chatId, message, {
      inline_keyboard: keyboard
    })
  }
  
  // Выбор плана подписки
  else if (data.startsWith('select_plan_')) {
    const planId = parseInt(data.split('_')[2])
    
    // Получаем информацию о плане
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single()
    
    if (!plan) {
      await sendMessage(chatId, "❌ План не найден")
      return
    }
    
    const priceRub = plan.price_rub || (plan.price_usd * 95)
    const durationText = plan.duration_days === 30 ? '1 месяц' :
                        plan.duration_days === 90 ? '3 месяца' :
                        plan.duration_days === 365 ? '1 год' : `${plan.duration_days} дней`
    
    await sendMessage(chatId, `⏳ Создаю платеж...\n\n📦 План: ${durationText}\n💰 Сумма: ${priceRub}₽`)
    
    try {
      // Вызываем Edge Function для создания платежа
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      
      const paymentResponse = await fetch(`${supabaseUrl}/functions/v1/tbank-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.id,
          planId: planId
        })
      })
      
      const paymentData = await paymentResponse.json()
      
      if (!paymentData.success) {
        throw new Error(paymentData.error || 'Ошибка создания платежа')
      }
      
      // Отправляем ссылку на оплату
      await sendMessage(
        chatId,
        `✅ **Готово к оплате!**\n\n` +
        `📦 План: ${durationText}\n` +
        `💰 Сумма: ${priceRub}₽\n\n` +
        `🔒 Безопасная оплата через T-Bank\n` +
        `После оплаты подписка активируется автоматически.`,
        {
          inline_keyboard: [
            [{ text: "💳 Оплатить", url: paymentData.payment_url }],
            [{ text: "❌ Отмена", callback_data: "buy_subscription" }]
          ]
        }
      )
    } catch (error) {
      console.error('Payment creation error:', error)
      await sendMessage(
        chatId,
        `❌ **Ошибка создания платежа**\n\n${error.message}\n\nПопробуй еще раз или обратись к администратору.`,
        {
          inline_keyboard: [
            [{ text: "🔄 Попробовать снова", callback_data: "buy_subscription" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
    }
  }
  
  // Показать профиль
  else if (data === 'show_profile') {
    await showProfileMenu(chatId, user.id)
  }
  
  // Quick actions
  // 🌟 QUICK LOG: Показать шаблоны
  else if (data === 'quick_log') {
    try {
      const { data: templates, error } = await supabase
        .rpc('get_user_meal_templates', {
          p_user_id: user.id,
          p_limit: 10
        })

      if (error) throw error

      if (!templates || templates.length === 0) {
        await sendMessage(
          chatId,
          `⭐ **Быстрый лог**\n\n` +
          `У тебя пока нет сохраненных шаблонов.\n\n` +
          `💡 Залогируй еду и нажми "⭐ В избранное" чтобы создать шаблон!`,
          {
            inline_keyboard: [
              [{ text: "🍽 Записать прием пищи", callback_data: "quick_log_food" }],
              [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
            ]
          }
        )
        return
      }

      let templatesList = `⚡ **Быстрый лог**\n\n`
      templatesList += `Выбери блюдо для быстрого логирования:\n\n`

      const keyboard: any[] = []

      templates.forEach((template: any, index: number) => {
        const calories = Math.round(template.calories)
        templatesList += `${template.emoji} **${template.template_name}**\n`
        templatesList += `   🔥 ${calories} ккал | Б:${template.protein}г Ж:${template.fats}г У:${template.carbs}г\n\n`

        keyboard.push([{
          text: `${template.emoji} ${template.template_name} (${calories} ккал)`,
          callback_data: `use_template_${template.id}`
        }])
      })

      keyboard.push([{ text: "🍽 Записать новое", callback_data: "quick_log_food" }])
      keyboard.push([{ text: "🏠 Главное меню", callback_data: "main_menu" }])

      await sendMessage(chatId, templatesList, { inline_keyboard: keyboard })

    } catch (error) {
      console.error('Error getting templates:', error)
      await sendMessage(chatId, "❌ Ошибка загрузки шаблонов")
    }
  }

  else if (data === 'quick_log_food') {
    await setUserState(userId, 'logging_food', {})
    await sendMessage(
      chatId,
      `🍽 **Запись приема пищи**\n\nНапиши или наговори, что ты поел/выпил.\n\n💡 **Для точности:** укажи каждый продукт с граммовкой.\n📝 **Важно:** крупы взвешиваем в сухом виде, мясо — в готовом.\n\nМожешь написать примерно: "тарелка супа" или "рис с мясом" — я уточню детали.`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Отмена действия
  else if (data === 'cancel_action') {
    await clearUserState(userId)
    await sendMessage(chatId, "❌ Действие отменено", getMainKeyboard())
  }
  
  // Очистить все предпочтения
  else if (data === 'clear_all_preferences') {
    // Удаляем все предпочтения пользователя
    const { error } = await supabase
      .from('user_preferences')
      .delete()
      .eq('user_id', user.id)
    
    if (error) {
      console.error('Error clearing preferences:', error)
      await sendMessage(chatId, "❌ Ошибка очистки предпочтений")
    } else {
      await sendMessage(chatId, "✅ Все предпочтения удалены.\n\nТеперь ты можешь установить новые в диалоге с C.I.D.", getMainKeyboard())
    }
  }
  
  // Очистить историю диалога
  else if (data === 'clear_chat_history') {
    await clearChatHistory(user.id)
    await sendMessage(chatId, "✅ История диалога очищена.\n\nНачнем с чистого листа! 🎯", getMainKeyboard())
  }
  
  // Управление приемами пищи
  else if (data === 'manage_meals') {
    await manageMeals(chatId, user.id)
  }
  
  // Удаление приема пищи (показать подтверждение)
  else if (data.startsWith('delete_meal_')) {
    const mealId = parseInt(data.split('_')[2])
    await deleteMeal(chatId, user.id, mealId)
  }

  // 🌟 QUICK LOG: Использовать шаблон
  else if (data.startsWith('use_template_')) {
    const templateId = parseInt(data.split('_')[2])

    try {
      await sendMessage(chatId, "⏳ Логирую...")

      const { data: result, error } = await supabase
        .rpc('use_meal_template', {
          p_user_id: user.id,
          p_template_id: templateId
        })

      if (error || !result.success) {
        throw new Error(result?.error || 'Unknown error')
      }

      // Обновляем streak
      let streakInfo: any = null
      try {
        const { data: streakData } = await supabase
          .rpc('update_user_streak', { p_user_id: user.id })
          .single()
        if (streakData) streakInfo = streakData
      } catch (e) {
        console.error('Error updating streak:', e)
      }

      // Формируем streak информацию
      let streakText = ''
      if (streakInfo) {
        streakText = `\n\n🔥 **Streak: ${streakInfo.current_streak} ${streakInfo.current_streak === 1 ? 'день' : streakInfo.current_streak < 5 ? 'дня' : 'дней'}!**`
        if (streakInfo.is_new_record) streakText += ` 🎉 Новый рекорд!`
        if (streakInfo.earned_achievements && streakInfo.earned_achievements.length > 0) {
          streakText += `\n\n🏆 **Новые достижения:**\n${streakInfo.earned_achievements.join('\n')}`
        }
      }

      const resultText = `✅ **Прием пищи записан!**\n\n` +
        `⭐ **${result.template_name}**\n\n` +
        `🔥 ${Math.round(result.calories)} ккал | 🥩 Б: ${result.protein}г | 🥑 Ж: ${result.fats}г | 🍞 У: ${result.carbs}г${streakText}`

      await sendMessage(chatId, resultText, afterFoodLogKeyboard())

    } catch (error) {
      console.error('Error using template:', error)
      await sendMessage(chatId, "❌ Ошибка логирования. Попробуй еще раз.")
    }
  }

  // Подтверждение удаления приема пищи
  else if (data.startsWith('confirm_delete_meal_')) {
    const mealId = parseInt(data.split('_')[3])
    await confirmDeleteMeal(chatId, user.id, mealId)
  }
  
  // Редактирование приема пищи
  // 🌟 QUICK LOG: Сохранить в избранное
  else if (data.startsWith('save_template_')) {
    const mealId = parseInt(data.split('_')[2])
    await setUserState(userId, 'saving_template', { mealId })
    await sendMessage(
      chatId,
      `⭐ **Сохранение в избранное**\n\n` +
      `Как назвать этот шаблон?\n` +
      `Например: "Мой завтрак", "Стандартный обед", "Перекус"\n\n` +
      `💡 Шаблоны помогут быстро логировать частые блюда!`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }

  else if (data.startsWith('edit_meal_')) {
    const mealId = parseInt(data.split('_')[2])

    // Получаем информацию о приеме
    const { data: meal } = await supabase
      .from('food_logs')
      .select('*')
      .eq('id', mealId)
      .eq('user_id', user.id)
      .single()

    if (meal) {
      await setUserState(userId, 'editing_meal', { mealId: mealId, originalDescription: meal.description })
      await sendMessage(
        chatId,
        `✏️ **Редактирование приема пищи**\n\n` +
        `**Текущее описание:**\n${meal.description}\n\n` +
        `**Текущие КБЖУ:**\n🔥 ${meal.calories}ккал | Б:${meal.protein}г | Ж:${meal.fats}г | У:${meal.carbs}г\n\n` +
        `Напиши или наговори новое описание приема пищи:`,
        {
          inline_keyboard: [
            [{ text: "❌ Отмена", callback_data: "manage_meals" }]
          ]
        }
      )
    } else {
      await sendMessage(chatId, "❌ Прием пищи не найден")
    }
  }
  
  // Редактирование плана КБЖУ
  else if (data === 'edit_nutrition') {
    await sendMessage(
      chatId,
      `📊 **Изменение плана КБЖУ**\n\n` +
      `Я могу пересчитать твой план на основе текущих параметров или ты можешь ввести желаемые значения вручную.\n\n` +
      `Что ты хочешь сделать?`,
      {
        inline_keyboard: [
          [{ text: "🔄 Пересчитать автоматически", callback_data: "recalculate_nutrition" }],
          [{ text: "✏️ Ввести вручную", callback_data: "manual_nutrition" }],
          [{ text: "🔙 Назад", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Пересчет плана КБЖУ
  else if (data === 'recalculate_nutrition') {
    await sendMessage(chatId, "⏳ Пересчитываю твой план...")

    // ⚡ PHASE 2 OPTIMIZATION: используем getUserFullContextById
    const context = await getUserFullContextById(user.id)
    const profile = context?.profile

    if (profile) {
      try {
        // Генерируем новый план
        const plan = await generateNutritionPlan(profile)
        
        // Деактивируем старые планы
        await supabase
          .from('nutrition_plans')
          .update({ is_active: false })
          .eq('user_id', user.id)
        
        // Сохраняем новый план
        await supabase
          .from('nutrition_plans')
          .insert({
            user_id: user.id,
            calories: plan.target_calories,
            protein: plan.protein_grams,
            fats: plan.fats_grams,
            carbs: plan.carbs_grams,
            water: plan.water_liters,
            bmr: plan.bmr,
            tdee: plan.tdee,
            methodology_explanation: plan.methodology_explanation,
            activity_recommendations: plan.activity_recommendations,
            is_active: true
          })
        
        await sendMessage(
          chatId,
          `✅ **План КБЖУ пересчитан!**\n\n` +
          `🔥 Калории: ${Math.round(plan.target_calories)} ккал\n` +
          `🍗 Белки: ${Math.round(plan.protein_grams)} г\n` +
          `🥑 Жиры: ${Math.round(plan.fats_grams)} г\n` +
          `🍞 Углеводы: ${Math.round(plan.carbs_grams)} г\n` +
          `💧 Вода: ${Math.round(plan.water_liters * 10) / 10} л`,
          {
            inline_keyboard: [
              [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
            ]
          }
        )
      } catch (error) {
        console.error('Error recalculating nutrition plan:', error)
        await sendMessage(chatId, "❌ Ошибка пересчета плана")
      }
    } else {
      await sendMessage(chatId, "❌ Профиль не найден")
    }
  }
  
  // Ручной ввод плана КБЖУ
  else if (data === 'manual_nutrition') {
    await setUserState(userId, 'entering_manual_nutrition', {})
    await sendMessage(
      chatId,
      `✏️ **Ручной ввод плана КБЖУ**\n\n` +
      `Введи желаемые значения в формате:\n` +
      `**Калории Белки Жиры Углеводы Вода**\n\n` +
      `Например: **2000 120 60 250 2000**\n\n` +
      `📝 Все значения указываются в граммах, вода - в мл`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Редактирование параметров профиля
  else if (data === 'edit_parameters') {
    await sendMessage(
      chatId,
      `✏️ **Изменение параметров**\n\n` +
      `Выбери, что хочешь изменить:`,
      {
        inline_keyboard: [
          [{ text: "⚖️ Вес", callback_data: "edit_weight" }],
          [{ text: "📏 Рост", callback_data: "edit_height" }],
          [{ text: "🎂 Возраст", callback_data: "edit_age" }],
          [{ text: "🏃 Активность", callback_data: "edit_activity" }],
          [{ text: "🔙 Назад", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Редактирование веса
  else if (data === 'edit_weight') {
    await setUserState(userId, 'editing_weight', {})
    await sendMessage(
      chatId,
      `⚖️ **Изменение веса**\n\nВведи свой новый вес в килограммах:`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Редактирование роста
  else if (data === 'edit_height') {
    await setUserState(userId, 'editing_height', {})
    await sendMessage(
      chatId,
      `📏 **Изменение роста**\n\nВведи свой рост в сантиметрах:`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Редактирование возраста
  else if (data === 'edit_age') {
    await setUserState(userId, 'editing_age', {})
    await sendMessage(
      chatId,
      `🎂 **Изменение возраста**\n\nВведи свой возраст в годах:`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }
  
  // Редактирование активности
  else if (data === 'edit_activity') {
    await sendMessage(
      chatId,
      `🏃 **Изменение уровня активности**\n\nВыбери свой уровень активности:`,
      activityKeyboard()
    )
  }

  // 📊 CHARTS: Показать график калорий
  else if (data === 'chart_calories' || data === 'show_charts') {
    try {
      await sendMessage(chatId, "⏳ Генерирую график...")

      // Вызываем Edge Function для генерации графика
      const response = await fetch(`${SUPABASE_URL}/functions/v1/progress-charts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          userId: user.id,
          chatId: chatId,
          chartType: 'calories',
          days: 30
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate chart')
      }
    } catch (error) {
      console.error('Error generating chart:', error)
      await sendMessage(chatId, "❌ Ошибка генерации графика. Попробуй позже.")
    }
  }

  // 📊 CHARTS: Показать график белка
  else if (data === 'chart_protein') {
    try {
      await sendMessage(chatId, "⏳ Генерирую график...")

      const response = await fetch(`${SUPABASE_URL}/functions/v1/progress-charts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          userId: user.id,
          chatId: chatId,
          chartType: 'protein',
          days: 30
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate chart')
      }
    } catch (error) {
      console.error('Error generating chart:', error)
      await sendMessage(chatId, "❌ Ошибка генерации графика. Попробуй позже.")
    }
  }

  // 📊 CHARTS: Показать график веса
  else if (data === 'chart_weight') {
    try {
      await sendMessage(chatId, "⏳ Генерирую график...")

      const response = await fetch(`${SUPABASE_URL}/functions/v1/progress-charts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          userId: user.id,
          chatId: chatId,
          chartType: 'weight',
          days: 90
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate chart')
      }
    } catch (error) {
      console.error('Error generating chart:', error)
      await sendMessage(chatId, "❌ Ошибка генерации графика. Попробуй позже.")
    }
  }

  // ⚖️ WEIGHT: Записать вес
  else if (data === 'log_weight') {
    await setUserState(userId, 'logging_weight', {})
    await sendMessage(
      chatId,
      `⚖️ **Запись веса**\n\n` +
      `Введи свой текущий вес в килограммах.\n` +
      `Например: **75.5**\n\n` +
      `💡 Для точности взвешивайся утром натощак.`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "cancel_action" }]
        ]
      }
    )
  }

  // 🛒 SHOPPING LIST: Генерация списка покупок
  else if (data === 'shopping_list' || data.startsWith('shopping_list_')) {
    try {
      let days = 7
      if (data.startsWith('shopping_list_')) {
        days = parseInt(data.split('_')[2])
      }

      await sendMessage(chatId, `⏳ Генерирую список покупок на ${days} дней...`)

      // Вызываем Edge Function для генерации списка покупок
      const response = await fetch(`${SUPABASE_URL}/functions/v1/shopping-list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          userId: user.id,
          chatId: chatId,
          days: days
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate shopping list')
      }
    } catch (error) {
      console.error('Error generating shopping list:', error)
      await sendMessage(chatId, "❌ Ошибка генерации списка покупок. Попробуй позже.")
    }
  }

  // 💧 WATER: Логирование воды (кнопки быстрого выбора)
  else if (data.startsWith('log_water_')) {
    const amountMl = parseInt(data.split('_')[2])

    try {
      const { data: result, error } = await supabase
        .rpc('log_water_intake', {
          p_user_id: user.id,
          p_amount_ml: amountMl,
          p_note: null
        })

      if (error || !result.success) {
        throw new Error('Failed to log water')
      }

      const todayTotalL = (result.today_total_ml / 1000).toFixed(1)
      const targetL = (result.target_ml / 1000).toFixed(1)
      const remainingL = (result.remaining_ml / 1000).toFixed(1)
      const progressPercent = result.progress_percent

      let progressBar = ''
      const filledSegments = Math.floor(progressPercent / 10)
      for (let i = 0; i < 10; i++) {
        progressBar += i < filledSegments ? '💧' : '⚪'
      }

      let messageText = `✅ **Вода записана!**\n\n`
      messageText += `💧 **+${amountMl} мл**\n\n`
      messageText += `📊 **Прогресс:**\n${progressBar} ${progressPercent}%\n\n`
      messageText += `💧 Выпито: **${todayTotalL}л** / ${targetL}л\n`

      if (result.remaining_ml > 0) {
        messageText += `📌 Осталось: **${remainingL}л**`
      } else {
        messageText += `🎉 **Цель достигнута!**`
      }

      await sendMessage(chatId, messageText, {
        inline_keyboard: [
          [
            { text: "💧 Еще воды", callback_data: "quick_log_water" },
            { text: "📊 Статистика", callback_data: "water_stats" }
          ],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      })
    } catch (error) {
      console.error('Error logging water:', error)
      await sendMessage(chatId, "❌ Ошибка записи воды")
    }
  }

  // 💧 WATER: Быстрое логирование (показать кнопки выбора)
  else if (data === 'quick_log_water') {
    await sendMessage(
      chatId,
      `💧 **Сколько воды выпил?**\n\nВыбери количество:`,
      {
        inline_keyboard: [
          [
            { text: "250 мл", callback_data: "log_water_250" },
            { text: "500 мл", callback_data: "log_water_500" }
          ],
          [
            { text: "1 литр", callback_data: "log_water_1000" },
            { text: "1.5 литра", callback_data: "log_water_1500" }
          ],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  // 💧 WATER: Статистика воды
  else if (data === 'water_stats') {
    try {
      const { data: stats } = await supabase
        .rpc('get_water_stats_today', { p_user_id: user.id })

      if (stats) {
        const todayTotalL = (stats.today_total_ml / 1000).toFixed(1)
        const targetL = (stats.target_ml / 1000).toFixed(1)
        const progressPercent = stats.progress_percent

        let progressBar = ''
        const filledSegments = Math.floor(progressPercent / 10)
        for (let i = 0; i < 10; i++) {
          progressBar += i < filledSegments ? '💧' : '⚪'
        }

        let messageText = `💧 **Статистика воды за сегодня**\n\n`
        messageText += `${progressBar} ${progressPercent}%\n\n`
        messageText += `💧 Выпито: **${todayTotalL}л** / ${targetL}л\n`
        messageText += `📊 Логов: ${stats.logs_count}\n\n`

        if (stats.is_goal_reached) {
          messageText += `🎉 **Цель достигнута!** Отлично!`
        } else {
          const remainingL = (stats.remaining_ml / 1000).toFixed(1)
          messageText += `📌 Осталось: **${remainingL}л**`
        }

        await sendMessage(chatId, messageText, {
          inline_keyboard: [
            [{ text: "💧 Добавить воду", callback_data: "quick_log_water" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        })
      }
    } catch (error) {
      console.error('Error getting water stats:', error)
      await sendMessage(chatId, "❌ Ошибка получения статистики")
    }
  }

  // 🔥 НОВЫЕ ОБРАБОТЧИКИ: Произвольный объем воды
  else if (data === 'log_water_custom') {
    await setUserState(userId, 'entering_water_amount', {})
    await sendMessage(
      chatId,
      `💧 **Ввод объема воды**\n\n` +
      `Напиши сколько воды выпил:\n` +
      `• В миллилитрах: "500 мл"\n` +
      `• В литрах: "1.5 л"\n` +
      `• Или просто: "стакан", "бутылка"`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "main_menu" }]
        ]
      }
    )
  }

  // 🔥 НОВЫЕ ОБРАБОТЧИКИ: Меню "Ещё"
  else if (data === 'shopping_menu') {
    await sendMessage(
      chatId,
      `🛒 **Список покупок**\n\n` +
      `Я могу составить список покупок на основе твоего плана питания.\n\n` +
      `На сколько дней составить список?`,
      {
        inline_keyboard: [
          [
            { text: "📅 На 3 дня", callback_data: "shopping_list_3" },
            { text: "📅 На 7 дней", callback_data: "shopping_list_7" }
          ],
          [{ text: "📅 На 14 дней", callback_data: "shopping_list_14" }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  else if (data === 'progress_menu') {
    await sendMessage(
      chatId,
      `📈 **Мой прогресс**\n\n` +
      `Выбери график для просмотра:`,
      {
        inline_keyboard: [
          [
            { text: "🔥 Калории", callback_data: "chart_calories" },
            { text: "🥩 Белок", callback_data: "chart_protein" }
          ],
          [{ text: "⚖️ Вес", callback_data: "chart_weight" }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  else if (data === 'show_preferences') {
    await showUserPreferencesMenu(chatId, user.id)
  }

  else if (data === 'help_menu') {
    await showHelpMenu(chatId, user.id)
  }

  else if (data === 'show_subscription') {
    await showSubscriptionMenu(chatId, user.id)
  }

  // 🔥 Обработчики для "Моё меню"
  else if (data === 'my_templates') {
    // Показываем сохраненные шаблоны приемов пищи
    const { data: templates, error } = await supabase
      .from('user_meal_templates')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error || !templates || templates.length === 0) {
      await sendMessage(
        chatId,
        `🍽 **Мои шаблоны**\n\n` +
        `У тебя пока нет сохраненных шаблонов.\n\n` +
        `💡 **Как создать шаблон:**\n` +
        `1. Запиши прием пищи\n` +
        `2. Нажми "⭐ В избранное" под приемом\n` +
        `3. Шаблон появится здесь для быстрого логирования`,
        {
          inline_keyboard: [
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
      return
    }

    // Показываем список шаблонов
    const keyboard: any[][] = []
    for (const template of templates.slice(0, 10)) {
      keyboard.push([
        {
          text: `${template.template_name || 'Шаблон'} (${template.calories || '?'} ккал)`,
          callback_data: `use_template_${template.id}`
        }
      ])
    }
    keyboard.push([{ text: "🏠 Главное меню", callback_data: "main_menu" }])

    await sendMessage(
      chatId,
      `🍽 **Мои шаблоны**\n\n` +
      `Выбери шаблон для быстрого логирования:`,
      { inline_keyboard: keyboard }
    )
  }

  else if (data === 'my_recipes') {
    // Показываем сохраненные рецепты
    const { data: recipes, error } = await supabase
      .from('saved_recipes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error || !recipes || recipes.length === 0) {
      await sendMessage(
        chatId,
        `📖 **Мои рецепты**\n\n` +
        `У тебя пока нет сохраненных рецептов.\n\n` +
        `💡 **Как сохранить рецепт:**\n` +
        `1. Попроси меня предложить рецепт\n` +
        `2. Нажми "📖 Сохранить рецепт" под моим ответом\n` +
        `3. Рецепт появится здесь`,
        {
          inline_keyboard: [
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
      return
    }

    // Показываем список рецептов
    const keyboard: any[][] = []
    for (const recipe of recipes.slice(0, 10)) {
      keyboard.push([
        {
          text: `${recipe.name || 'Рецепт'} (${recipe.calories || '?'} ккал)`,
          callback_data: `view_recipe_${recipe.id}`
        }
      ])
    }
    keyboard.push([{ text: "🏠 Главное меню", callback_data: "main_menu" }])

    await sendMessage(
      chatId,
      `📖 **Мои рецепты**\n\n` +
      `Выбери рецепт для просмотра:`,
      { inline_keyboard: keyboard }
    )
  }

  // Кнопка "Назад" → Меню Настройки
  else if (data === 'settings_menu') {
    await sendMessage(
      chatId,
      `⚙️ **Настройки**\n\n` +
      `Управление профилем, целями и подпиской:`,
      settingsMenuKeyboard()
    )
  }

  // 🔥 Обработчики кнопок под AI-ответами
  else if (data === 'save_ai_recipe') {
    // Сохраняем последний рецепт от AI
    await sendMessage(
      chatId,
      `💾 **Сохранение рецепта**\n\n` +
      `Введи название для этого рецепта:\n\n` +
      `Например: "Овсянка с бананом" или "Курица в духовке"`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "main_menu" }]
        ]
      }
    )
    // Устанавливаем состояние для ввода названия
    await setUserState(userId, 'naming_recipe', {
      recipeText: callbackQuery.message?.text || '',
      messageId: callbackQuery.message?.message_id
    })
  }

  else if (data === 'save_ai_meal_plan') {
    // Сохраняем весь рацион
    await sendMessage(
      chatId,
      `💾 **Сохранение рациона**\n\n` +
      `Введи название для этого рациона:\n\n` +
      `Например: "План на понедельник" или "Мой стандартный день"`,
      {
        inline_keyboard: [
          [{ text: "❌ Отмена", callback_data: "main_menu" }]
        ]
      }
    )
    await setUserState(userId, 'naming_meal_plan', {
      mealPlanText: callbackQuery.message?.text || '',
      messageId: callbackQuery.message?.message_id
    })
  }

  else if (data === 'save_ai_items_separately') {
    // Показываем инструкцию по сохранению по отдельности
    await sendMessage(
      chatId,
      `💾 **Сохранение по отдельности**\n\n` +
      `Функция в разработке! Пока ты можешь:\n\n` +
      `1. Сохранить весь рацион → 📖 Сохранить рацион\n` +
      `2. Записать один прием → 🍽 Записать как прием\n\n` +
      `💡 Скоро добавим возможность выбирать отдельные блюда!`,
      {
        inline_keyboard: [
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  else if (data === 'log_ai_as_meal') {
    // Записываем AI-рецепт как прием пищи
    const messageText = callbackQuery.message?.text || ''

    // Извлекаем КБЖУ из текста AI (ищем паттерны типа "500 ккал" или "Калорий: 500")
    const caloriesMatch = messageText.match(/(\d+)\s*ккал/i)
    const proteinMatch = messageText.match(/белк[а-я]*:\s*(\d+)/i)
    const fatsMatch = messageText.match(/жир[а-я]*:\s*(\d+)/i)
    const carbsMatch = messageText.match(/углевод[а-я]*:\s*(\d+)/i)

    if (!caloriesMatch) {
      await sendMessage(
        chatId,
        `❌ **Не удалось извлечь КБЖУ**\n\n` +
        `Не нашел данные о калориях в рецепте. Попробуй записать прием вручную через чат.\n\n` +
        `Например: "съел овсянку 60г, банан"`,
        {
          inline_keyboard: [
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
      return
    }

    const calories = parseInt(caloriesMatch[1])
    const protein = proteinMatch ? parseInt(proteinMatch[1]) : 0
    const fats = fatsMatch ? parseInt(fatsMatch[1]) : 0
    const carbs = carbsMatch ? parseInt(carbsMatch[1]) : 0

    // Записываем как прием пищи
    const { data: meal, error } = await supabase
      .from('food_logs')
      .insert({
        user_id: user.id,
        description: 'Рецепт от AI',
        calories: calories,
        protein: protein,
        fats: fats,
        carbs: carbs,
        logged_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error logging AI meal:', error)
      await sendMessage(chatId, "❌ Ошибка при записи приема. Попробуй еще раз.")
      return
    }

    await sendMessage(
      chatId,
      `✅ **Прием записан!**\n\n` +
      `📊 КБЖУ: ${calories} ккал | Б: ${protein}г | Ж: ${fats}г | У: ${carbs}г\n\n` +
      `Что дальше?`,
      afterFoodLogKeyboard(meal.id)
    )
  }
}
/**
 * Обработка текстовых сообщений
 */
async function handleTextMessage(message: TelegramMessage) {
  const userId = message.from.id
  const stateData = await getUserState(userId)
  
  console.log('handleTextMessage - userId:', userId, 'text:', message.text, 'state:', stateData?.state)
  
  const user = await getOrCreateUser(
    message.from.id,
    message.from.username,
    message.from.first_name
  )
  
  // БЛОКИРОВКА: Проверяем подписку (кроме команды /start)
  if (message.text !== '/start') {
    const subscriptionData = await getSubscriptionInfo(user.id)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    // Если подписка истекла и это не unlimited
    if (subscriptionInfo && subscriptionInfo.needs_payment && !subscriptionInfo.is_unlimited) {
      const blockMessage = `⏰ **Пробный период истек**\n\n` +
        `😔 К сожалению, твой 7-дневный пробный период подошел к концу.\n\n` +
        `💎 **Продолжи пользоваться C.I.D.** — выбери подходящий тариф:\n\n` +
        `⚡ **1 месяц** — 129₽ (Попробовать)\n` +
        `🔥 **6 месяцев** — 649₽ (Популярный)\n` +
        `💎 **1 год** — 1099₽ (Выгодно!)\n\n` +
        `🔒 Безопасная оплата через T-Bank\n` +
        `✨ Подписка активируется моментально`
      
      await sendMessage(message.chat.id, blockMessage, {
        inline_keyboard: [
          [{ text: "💳 Оформить подписку", callback_data: "buy_subscription" }],
          [{ text: "👤 Мой профиль", callback_data: "show_profile" }]
        ]
      })
      return // Блокируем дальнейшую обработку
    }
  }
  
  // Сначала проверяем навигационные кнопки (они работают без состояния)
  const navigationButtons = [
    // Новые кнопки главного меню (3 кнопки)
    '📊 Дневник', '📖 Рецепты', '⚙️ Настройки',
    // Старые кнопки (для обратной совместимости)
    '💧 Вода', '📊 Мой день', '📖 Моё меню', '❓ Помощь',
    '🔙 Назад', '💬 Диалог с C.I.D.',
    '📊 КБЖУ + Вода', '📝 Мои приемы пищи',
    '👤 Профиль', '💎 Подписка', '🎯 Мои предпочтения',
    '🛒 Список покупок', '📈 Мой прогресс'
  ]

  if (navigationButtons.includes(message.text?.trim() || '')) {
    const handled = await handleNavigationButtons(message, user)
    if (handled) return
  }
  
  // Если нет состояния и это не навигационная кнопка
  // Если нет активного состояния - определяем намерение
  if (!stateData) {
    if (!message.text) return

    const intent = await detectIntent(message.text)
    console.log('Detected intent:', intent, 'for message:', message.text)

    if (intent === 'food') {
      // Автоматически записываем еду
      await handleFoodLogging(userId, message.chat.id, user.id, message.text, 0)
      return
    } else if (intent === 'water') {
      // Логируем воду
      await handleWaterLogging(userId, message.chat.id, user.id, message.text)
      return
    } else if (intent === 'question') {
      // 🔥 НОВАЯ ЛОГИКА: Умный чат - автоматически обрабатываем вопросы
      // 1. Извлекаем предпочтения из сообщения пользователя
      console.log(`🔍 Extracting preferences from message: "${message.text}"`)
      const extractedPrefs = await extractPreferencesFromText(message.text)
      console.log(`Found ${extractedPrefs.length} preferences:`, extractedPrefs)

      // 2. Сохраняем предпочтения если нашли
      if (extractedPrefs.length > 0) {
        for (const pref of extractedPrefs) {
          await saveUserPreference(
            user.id,
            pref.type as 'allergy' | 'intolerance' | 'dislike' | 'exclude' | 'preference',
            pref.item
          )
        }
        console.log(`✅ Saved ${extractedPrefs.length} preferences for user ${user.id}`)
      }

      // 3. Обрабатываем вопрос через AI-консультацию
      await handleRecipeRequest(userId, message.chat.id, user.id, message.text, message.message_id)
      return
    } else {
      // Неизвестное намерение - показываем главное меню
      await sendMessage(
        message.chat.id,
        `❓ Используй кнопки меню для навигации`,
        getMainKeyboard()
      )
      return
    }
  }
  
  // Ожидание имени
  if (stateData.state === 'waiting_name') {
    if (!message.text) return
    console.log('Processing name:', message.text)
    stateData.data.name = message.text
    stateData.state = 'waiting_gender'
    await setUserState(userId, stateData.state, stateData.data)
    await sendMessage(
      message.chat.id,
      `Приятно познакомиться, ${message.text}! 👋\n\n👤 Укажи свой пол:`,
      genderKeyboard()
    )
  }
  
  // Ожидание возраста
  else if (stateData.state === 'waiting_age') {
    if (!message.text) return
    console.log('Processing age:', message.text)
    const age = parseInt(message.text)
    if (isNaN(age) || age < 10 || age > 120) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный возраст (10-120 лет)")
      return
    }
    stateData.data.age = age
    stateData.state = 'waiting_weight'
    await setUserState(userId, stateData.state, stateData.data)
    await sendMessage(message.chat.id, "⚖️ Укажи свой текущий вес (в кг):")
  }
  
  // Ожидание веса
  else if (stateData.state === 'waiting_weight') {
    if (!message.text) return
    const weight = parseFloat(message.text.replace(',', '.'))
    if (isNaN(weight) || weight < 30 || weight > 300) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный вес (30-300 кг)")
      return
    }
    stateData.data.current_weight = weight
    stateData.state = 'waiting_height'
    await setUserState(userId, stateData.state, stateData.data)
    await sendMessage(message.chat.id, "📏 Укажи свой рост (в см):")
  }
  
  // Ожидание роста
  else if (stateData.state === 'waiting_height') {
    if (!message.text) return
    const height = parseFloat(message.text.replace(',', '.'))
    if (isNaN(height) || height < 100 || height > 250) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный рост (100-250 см)")
      return
    }
    stateData.data.height = height
    stateData.state = 'waiting_activity'
    await setUserState(userId, stateData.state, stateData.data)
    await sendMessage(
      message.chat.id,
      "💪 Выбери уровень активности:",
      activityKeyboard()
    )
  }
  
  // Ожидание пожеланий
  else if (stateData.state === 'waiting_wishes') {
    if (!message.text) return
    stateData.data.wishes = message.text
    await setUserState(userId, stateData.state, stateData.data)
    
    await sendMessage(message.chat.id, "⏳ Создаю твой персональный план КБЖУ...")
    
    // Генерируем план через OpenAI
    try {
      console.log('Generating nutrition plan for user:', user.id, stateData.data)
      const plan = await generateNutritionPlan(stateData.data)
      console.log('Plan generated:', plan)
      
      // Сохраняем профиль
      console.log('Saving user profile...')
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          ...stateData.data
        }, {
          onConflict: 'user_id'
        })
        .select()
        .single()
      
      if (profileError) {
        console.error('Error saving profile:', profileError)
        throw profileError
      }
      console.log('Profile saved:', profile)
      
      // Деактивируем старые планы
      console.log('Deactivating old plans...')
      const { error: deactivateError } = await supabase
        .from('nutrition_plans')
        .update({ is_active: false })
        .eq('user_id', user.id)
      
      if (deactivateError) {
        console.error('Error deactivating old plans:', deactivateError)
      }
      
      // Сохраняем новый план
      console.log('Saving new nutrition plan...')
      const { data: savedPlan, error: planError } = await supabase
        .from('nutrition_plans')
        .insert({
          user_id: user.id,
          calories: Math.round(plan.target_calories),
          protein: Math.round(plan.protein_grams),
          fats: Math.round(plan.fats_grams),
          carbs: Math.round(plan.carbs_grams),
          water: plan.water_liters,
          bmr: plan.bmr,
          tdee: plan.tdee,
          methodology_explanation: plan.methodology_explanation,
          activity_recommendations: plan.activity_recommendations,
          is_active: true
        })
        .select()
        .single()
      
      if (planError) {
        console.error('Error saving plan:', planError)
        throw planError
      }
      console.log('Plan saved:', savedPlan)
      
      // Формируем и отправляем карточку
      console.log('Formatting nutrition card...')
      const cardText = formatNutritionCard(plan, stateData.data)
      console.log('Sending card to user...')
      // Отправляем БЕЗ Markdown, чтобы избежать проблем с парсингом
      await sendMessage(message.chat.id, cardText, nutritionCardKeyboard(), '')
      console.log('Card sent successfully')
      
      await clearUserState(userId)
      console.log('Onboarding completed for user:', userId)
    } catch (error) {
      console.error('Error generating plan:', error)
      await sendMessage(message.chat.id, "❌ Ошибка создания плана. Попробуй еще раз /start")
    }
  }
  
  // Ожидание корректировки
  else if (stateData.state === 'waiting_adjustment') {
    if (!message.text) return
    await sendMessage(message.chat.id, "⏳ Корректирую план...")

    try {
      // ⚡ PHASE 2 OPTIMIZATION: 1 запрос вместо 2
      const context = await getUserFullContextById(user.id)
      const profile = context?.profile
      const currentPlan = context?.plan

      const adjusted = await adjustNutritionPlan(currentPlan, message.text, profile)
      
      // Формируем текст корректировки с датой
      const now = new Date()
      const dateStr = now.toLocaleDateString('ru-RU', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      
      const adjustmentText = `\n\n🔄 Корректировка (${dateStr}):\n${adjusted.adjustment_explanation}`
      
      // Убираем старые корректировки, оставляем только последние 2
      let cleanExplanation = currentPlan.methodology_explanation || ''
      
      // Разделяем по маркеру корректировки
      const parts = cleanExplanation.split('🔄 Корректировка')
      
      // Оставляем только исходное объяснение + последние 2 корректировки
      if (parts.length > 3) {
        // Берем исходное объяснение (первая часть) + последние 2 корректировки
        cleanExplanation = parts[0] + '🔄 Корректировка' + parts[parts.length - 2] + '🔄 Корректировка' + parts[parts.length - 1]
      }
      
      // Обновляем план
      await supabase
        .from('nutrition_plans')
        .update({
          calories: adjusted.target_calories,
          protein: adjusted.protein_grams,
          fats: adjusted.fats_grams,
          carbs: adjusted.carbs_grams,
          water: adjusted.water_liters,
          methodology_explanation: cleanExplanation + adjustmentText
        })
        .eq('id', currentPlan.id)
      
      // Получаем обновленный план
      const { data: updatedPlan } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('id', currentPlan.id)
        .single()
      
      const cardText = formatNutritionCard(updatedPlan, profile)
      await sendMessage(message.chat.id, cardText, nutritionCardKeyboard())
      
      await clearUserState(userId)
    } catch (error) {
      console.error('Error adjusting plan:', error)
      await sendMessage(message.chat.id, "❌ Ошибка корректировки плана. Попробуй еще раз.")
    }
  }
  
  // Запись приема пищи
  else if (stateData.state === 'logging_food') {
    if (!message.text) return
    const clarificationAttempt = stateData.data?.clarification_attempt || 0

    // Если это ответ на уточнение - комбинируем с исходным описанием
    let fullDescription = message.text
    if (clarificationAttempt > 0 && stateData.data?.original_description) {
      fullDescription = `${stateData.data.original_description} ${message.text}`
      console.log('Combined food description:', fullDescription)
    }

    await handleFoodLogging(userId, message.chat.id, user.id, fullDescription, clarificationAttempt)
  }

  // Запрос рецепта
  else if (stateData.state === 'requesting_recipe') {
    if (!message.text) return
    await handleRecipeRequest(userId, message.chat.id, user.id, message.text, message.message_id)
  }

  // Редактирование приема пищи (СПЕЦИАЛЬНЫЙ ОБРАБОТЧИК - ДОЛЖЕН БЫТЬ ПЕРЕД УНИВЕРСАЛЬНЫМ)
  else if (stateData.state === 'editing_meal') {
    if (!message.text) return
    await handleMealEdit(userId, message.chat.id, user.id, stateData.data.mealId, message.text)
  }

  // Редактирование конкретных параметров (УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК - ПОСЛЕ СПЕЦИАЛЬНЫХ)
  else if (stateData.state.startsWith('editing_')) {
    if (!message.text) return
    const param = stateData.state.replace('editing_', '')
    await handleParameterEdit(userId, message.chat.id, user.id, param, message.text)
  }

  // 🌟 QUICK LOG: Сохранение шаблона
  else if (stateData.state === 'saving_template') {
    if (!message.text) return

    const templateName = message.text.trim()
    if (templateName.length < 2 || templateName.length > 50) {
      await sendMessage(message.chat.id, "❌ Название должно быть от 2 до 50 символов. Попробуй еще раз.")
      return
    }

    await sendMessage(message.chat.id, "⏳ Сохраняю в избранное...")

    try {
      const { data: result, error } = await supabase
        .rpc('create_meal_template_from_log', {
          p_user_id: user.id,
          p_food_log_id: stateData.data.mealId,
          p_template_name: templateName,
          p_emoji: '⭐'
        })

      if (error || !result.success) {
        throw new Error(result?.error || 'Unknown error')
      }

      await sendMessage(
        message.chat.id,
        `✅ **Шаблон сохранен!**\n\n` +
        `⭐ **"${templateName}"**\n\n` +
        `Теперь ты можешь быстро логировать это блюдо через "⚡ Быстрый лог"`,
        {
          inline_keyboard: [
            [{ text: "⚡ Быстрый лог", callback_data: "quick_log" }],
            [{ text: "📊 Статистика", callback_data: "diary" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )

      await clearUserState(userId)
    } catch (error) {
      console.error('Error saving template:', error)
      await sendMessage(message.chat.id, "❌ Ошибка сохранения шаблона. Попробуй еще раз.")
    }
  }

  // ⚖️ Логирование веса
  else if (stateData.state === 'logging_weight') {
    if (!message.text) return
    const weight = parseFloat(message.text.replace(',', '.'))
    if (isNaN(weight) || weight < 30 || weight > 300) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный вес (30-300 кг)")
      return
    }

    await sendMessage(message.chat.id, "⏳ Сохраняю...")

    try {
      // Логируем вес
      console.log('Calling log_weight for user:', user.id, 'weight:', weight)
      const { data: result, error } = await supabase
        .rpc('log_weight', {
          p_user_id: user.id,
          p_weight: weight,
          p_note: null
        })

      console.log('log_weight response:', { result, error })

      if (error) {
        console.error('DB error:', error)
        throw new Error(`DB error: ${error.message}`)
      }

      if (!result) {
        throw new Error('No result from log_weight function')
      }

      if (!result.success) {
        throw new Error(`log_weight returned success=false: ${JSON.stringify(result)}`)
      }

      let changeText = ''
      if (result.previous_weight && result.weight_change !== 0) {
        const changeValue = Math.abs(result.weight_change)
        const changeDirection = result.weight_change > 0 ? '+' : '-'
        changeText = `\n\n📈 Изменение: **${changeDirection}${changeValue.toFixed(1)}** кг` +
          `\n(Предыдущий вес: ${result.previous_weight} кг)`
      }

      await sendMessage(
        message.chat.id,
        `✅ **Вес записан!**\n\n` +
        `⚖️ **${weight} кг**${changeText}\n\n` +
        `💡 Продолжай взвешиваться регулярно для отслеживания прогресса!`,
        {
          inline_keyboard: [
            [{ text: "📊 График веса", callback_data: "chart_weight" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )

      await clearUserState(userId)
    } catch (error) {
      console.error('Error logging weight:', error)
      await sendMessage(message.chat.id, "❌ Ошибка сохранения веса. Попробуй еще раз.")
    }
  }

  // Редактирование веса
  else if (stateData.state === 'editing_weight') {
    if (!message.text) return
    const weight = parseFloat(message.text.replace(',', '.'))
    if (isNaN(weight) || weight < 30 || weight > 300) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный вес (30-300 кг)")
      return
    }
    
    // Обновляем вес в профиле
    await supabase
      .from('user_profiles')
      .update({ current_weight: weight })
      .eq('user_id', user.id)
    
    await clearUserState(userId)
    await sendMessage(message.chat.id, `✅ Вес обновлен: **${weight} кг**\n\n💡 Хочешь пересчитать план КБЖУ с новым весом?`, {
      inline_keyboard: [
        [{ text: "🔄 Да, пересчитать", callback_data: "recalculate_nutrition" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
  }
  
  // Редактирование роста
  else if (stateData.state === 'editing_height') {
    if (!message.text) return
    const height = parseFloat(message.text.replace(',', '.'))
    if (isNaN(height) || height < 100 || height > 250) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный рост (100-250 см)")
      return
    }
    
    // Обновляем рост в профиле
    await supabase
      .from('user_profiles')
      .update({ height: height })
      .eq('user_id', user.id)
    
    await clearUserState(userId)
    await sendMessage(message.chat.id, `✅ Рост обновлен: **${height} см**\n\n💡 Хочешь пересчитать план КБЖУ с новым ростом?`, {
      inline_keyboard: [
        [{ text: "🔄 Да, пересчитать", callback_data: "recalculate_nutrition" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
  }
  
  // Редактирование возраста
  else if (stateData.state === 'editing_age') {
    if (!message.text) return
    const age = parseInt(message.text)
    if (isNaN(age) || age < 10 || age > 120) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи корректный возраст (10-120 лет)")
      return
    }
    
    // Обновляем возраст в профиле
    await supabase
      .from('user_profiles')
      .update({ age: age })
      .eq('user_id', user.id)
    
    await clearUserState(userId)
    await sendMessage(message.chat.id, `✅ Возраст обновлен: **${age} лет**\n\n💡 Хочешь пересчитать план КБЖУ с новым возрастом?`, {
      inline_keyboard: [
        [{ text: "🔄 Да, пересчитать", callback_data: "recalculate_nutrition" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
  }
  
  // Ввод суммы доната
  else if (stateData.state === 'entering_donation_amount') {
    if (!message.text) return
    const amount = parseInt(message.text.replace(/\D/g, ''))
    
    if (isNaN(amount) || amount < 50 || amount > 10000) {
      await sendMessage(message.chat.id, "❌ Пожалуйста, укажи сумму от 50₽ до 10000₽")
      return
    }
    
    await clearUserState(userId)
    await createDonationPayment(message.chat.id, user.id, amount)
  }
  
  // Ручной ввод КБЖУ
  else if (stateData.state === 'entering_manual_nutrition') {
    if (!message.text) return
    const values = message.text.trim().split(/\s+/)
    
    if (values.length !== 5) {
      await sendMessage(message.chat.id, "❌ Неверный формат. Введи 5 значений через пробел:\n**Калории Белки Жиры Углеводы Вода**")
      return
    }
    
    const [calories, protein, fat, carbs, water] = values.map(v => parseFloat(v.replace(',', '.')))
    
    if (calories < 500 || calories > 5000 || protein < 0 || fat < 0 || carbs < 0 || water < 0) {
      await sendMessage(message.chat.id, "❌ Некорректные значения. Проверь введенные данные.")
      return
    }
    
    // Деактивируем старый план
    await supabase
      .from('nutrition_plans')
      .update({ is_active: false })
      .eq('user_id', user.id)
    
    // Создаем новый план
    await supabase
      .from('nutrition_plans')
      .insert({
        user_id: user.id,
        calories: Math.round(calories),
        protein: Math.round(protein),
        fats: Math.round(fat),
        carbs: Math.round(carbs),
        water: Math.round(water / 1000), // Конвертируем мл в литры
        is_active: true
      })
    
    await clearUserState(userId)
    await sendMessage(
      message.chat.id,
      `✅ **План КБЖУ обновлен!**\n\n` +
      `🔥 Калории: ${Math.round(calories)} ккал\n` +
      `🍗 Белки: ${Math.round(protein)} г\n` +
      `🥑 Жиры: ${Math.round(fat)} г\n` +
      `🍞 Углеводы: ${Math.round(carbs)} г\n` +
      `💧 Вода: ${Math.round(water)} мл`,
      {
        inline_keyboard: [
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  // 🔥 НОВЫЙ: Ввод произвольного объема воды
  else if (stateData.state === 'entering_water_amount') {
    if (!message.text) return

    const text = message.text.toLowerCase().trim()
    let amountMl = 0

    // Парсим объем воды
    if (text.includes('стакан')) {
      amountMl = 250
    } else if (text.includes('бутылка') || text.includes('бутылку')) {
      amountMl = 500
    } else if (text.match(/(\d+\.?\d*)\s*л(?:итр)?/)) {
      const liters = parseFloat(text.match(/(\d+\.?\d*)\s*л(?:итр)?/)![1])
      amountMl = liters * 1000
    } else if (text.match(/(\d+)\s*мл/)) {
      amountMl = parseInt(text.match(/(\d+)\s*мл/)![1])
    } else {
      await sendMessage(message.chat.id, "❌ Не могу распознать объем. Попробуй:\n• 500 мл\n• 1.5 л\n• стакан\n• бутылка")
      return
    }

    if (amountMl < 50 || amountMl > 5000) {
      await sendMessage(message.chat.id, "❌ Объем должен быть от 50мл до 5л")
      return
    }

    try {
      const { data: result, error } = await supabase
        .rpc('log_water_intake', {
          p_user_id: user.id,
          p_amount_ml: amountMl,
          p_note: null
        })

      if (error || !result.success) {
        throw new Error('Failed to log water')
      }

      const todayTotalL = (result.today_total_ml / 1000).toFixed(1)
      const targetL = (result.target_ml / 1000).toFixed(1)
      const progressPercent = Math.round((result.today_total_ml / result.target_ml) * 100)
      const amountL = (amountMl / 1000).toFixed(1)

      let messageText = `✅ **Вода записана: ${amountL}л**\n\n`
      messageText += `💧 Сегодня: **${todayTotalL}л** / ${targetL}л (${progressPercent}%)\n\n`

      if (result.remaining_ml > 0) {
        const remainingL = (result.remaining_ml / 1000).toFixed(1)
        messageText += `📌 Осталось: **${remainingL}л**`
      } else {
        messageText += `🎉 **Цель достигнута!**`
      }

      await clearUserState(userId)
      await sendMessage(message.chat.id, messageText, {
        inline_keyboard: [
          [{ text: "💧 Еще воды", callback_data: "quick_log_water" }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      })
    } catch (error) {
      console.error('Error logging water:', error)
      await sendMessage(message.chat.id, "❌ Ошибка записи воды")
    }
  }

  // 🔥 Сохранение рецепта - ввод названия
  else if (stateData.state === 'naming_recipe') {
    if (!message.text) return

    const recipeName = message.text.trim()
    const recipeText = stateData.data?.recipeText || ''

    // Извлекаем КБЖУ из текста рецепта
    const caloriesMatch = recipeText.match(/(\d+)\s*ккал/i)
    const proteinMatch = recipeText.match(/белк[а-я]*:\s*(\d+)/i)
    const fatsMatch = recipeText.match(/жир[а-я]*:\s*(\d+)/i)
    const carbsMatch = recipeText.match(/углевод[а-я]*:\s*(\d+)/i)

    // Сохраняем рецепт
    const { error } = await supabase
      .from('saved_recipes')
      .insert({
        user_id: user.id,
        name: recipeName,
        content: recipeText,
        calories: caloriesMatch ? parseInt(caloriesMatch[1]) : null,
        protein: proteinMatch ? parseInt(proteinMatch[1]) : null,
        fats: fatsMatch ? parseInt(fatsMatch[1]) : null,
        carbs: carbsMatch ? parseInt(carbsMatch[1]) : null,
        created_at: new Date().toISOString()
      })

    if (error) {
      console.error('Error saving recipe:', error)
      await sendMessage(message.chat.id, "❌ Ошибка при сохранении рецепта. Попробуй еще раз.")
      return
    }

    await clearUserState(userId)
    await sendMessage(
      message.chat.id,
      `✅ **Рецепт сохранен!**\n\n` +
      `📖 "${recipeName}"\n\n` +
      `Теперь ты можешь найти его в **Моё меню → Мои рецепты**`,
      {
        inline_keyboard: [
          [{ text: "📖 Мои рецепты", callback_data: "my_recipes" }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  // 🔥 Сохранение рациона - ввод названия
  else if (stateData.state === 'naming_meal_plan') {
    if (!message.text) return

    const mealPlanName = message.text.trim()
    const mealPlanText = stateData.data?.mealPlanText || ''

    // Сохраняем рацион
    const { error } = await supabase
      .from('saved_recipes')
      .insert({
        user_id: user.id,
        name: mealPlanName,
        content: mealPlanText,
        is_meal_plan: true,
        created_at: new Date().toISOString()
      })

    if (error) {
      console.error('Error saving meal plan:', error)
      await sendMessage(message.chat.id, "❌ Ошибка при сохранении рациона. Попробуй еще раз.")
      return
    }

    await clearUserState(userId)
    await sendMessage(
      message.chat.id,
      `✅ **Рацион сохранен!**\n\n` +
      `📖 "${mealPlanName}"\n\n` +
      `Теперь ты можешь найти его в **Моё меню → Мои рецепты**`,
      {
        inline_keyboard: [
          [{ text: "📖 Мои рецепты", callback_data: "my_recipes" }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  }

  // Если состояние неизвестно - показываем главное меню
  else {
    console.log('Unhandled state:', stateData?.state, 'with text:', message.text)
    await sendMessage(
      message.chat.id,
      "❓ Используй кнопки меню для навигации",
      getMainKeyboard()
    )
  }
}
/**
 * Обработка навигационных кнопок
 */
async function handleNavigationButtons(message: TelegramMessage, user: any) {
  const text = message.text?.trim()
  const chatId = message.chat.id

  switch (text) {
    // Главное меню
    case '🔙 Назад':
      await clearUserState(message.from.id)
      await sendMessage(chatId, "🏠 **Главное меню**", getMainKeyboard())
      break

    // 🔥 НОВЫЕ ГЛАВНЫЕ КНОПКИ (3 шт)
    case '📊 Дневник':
      await showDiary(chatId, user.id)
      break

    case '📖 Рецепты':
      await sendMessage(
        chatId,
        `📖 **Рецепты**\n\n` +
        `Здесь хранятся твои сохраненные шаблоны и рецепты.\n\n` +
        `**🍽 Мои шаблоны** - быстрое логирование повторяющихся приемов пищи\n` +
        `**📖 Мои рецепты** - сохраненные рецепты с инструкциями\n` +
        `**🛒 Список покупок** - автоматический список на основе рациона`,
        myMenuKeyboard()
      )
      break

    // 🔥 Кнопка: Вода (inline выбор объема)
    case '💧 Вода':
      await sendMessage(
        chatId,
        `💧 **Сколько воды выпил?**\n\nВыбери быстро или введи свой объем:`,
        quickWaterKeyboard()
      )
      break

    // 🔥 Кнопка: Мой день (сразу показываем дневник + actions)
    case '📊 Мой день':
      await showDiary(chatId, user.id)
      break

    // 🔥 Кнопка: Моё меню (шаблоны + рецепты)
    case '📖 Моё меню':
      await sendMessage(
        chatId,
        `📖 **Моё меню**\n\n` +
        `Здесь хранятся твои сохраненные шаблоны и рецепты.\n\n` +
        `**🍽 Мои шаблоны** - быстрое логирование повторяющихся приемов пищи\n` +
        `**📖 Мои рецепты** - сохраненные рецепты с инструкциями\n` +
        `**🛒 Список покупок** - автоматический список на основе рациона`,
        myMenuKeyboard()
      )
      break

    // 🔥 Кнопка: Профиль
    case '👤 Профиль':
      await sendMessage(
        chatId,
        `👤 **Профиль**\n\n` +
        `Управление профилем, целями и подпиской:`,
        settingsMenuKeyboard()
      )
      break

    // 🔥 Кнопка: Помощь (мануал)
    case '❓ Помощь':
      await sendMessage(
        chatId,
        `❓ **Помощь**\n\n` +
        `**Умный чат:**\n` +
        `Просто пиши в чат - я сам пойму что делать!\n` +
        `• "съел овсянку 60г, банан" → запишу прием\n` +
        `• "выпил 500мл воды" → запишу воду\n` +
        `• "что на ужин?" → дам рецепт\n` +
        `• "я не ем рыбу" → запомню предпочтения\n\n` +
        `**Кнопки:**\n` +
        `📊 **Дневник** - КБЖУ, вода, приемы пищи\n` +
        `📖 **Рецепты** - сохраненные шаблоны и рецепты\n` +
        `👤 **Профиль** - настройки, цели, подписка\n` +
        `❓ **Помощь** - инструкция по использованию бота\n\n` +
        `**Сохранение рецептов:**\n` +
        `Когда я предлагаю рецепт, под сообщением появятся кнопки:\n` +
        `• 📖 Сохранить рецепт\n` +
        `• 🍽 Записать как прием\n` +
        `• 💾 Сохранить по отдельности (для рационов)\n\n` +
        `**Подсказка:** Я запоминаю контекст разговора, как ChatGPT!`,
        {
          inline_keyboard: [
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }],
            [{ text: "💝 Поддержать проект", callback_data: "support_project" }]
          ]
        }
      )
      break

    // СТАРЫЕ КНОПКИ (для обратной совместимости)
    case '📊 КБЖУ + Вода':
      await showDiary(chatId, user.id)
      break

    case '📝 Мои приемы пищи':
      await manageMeals(chatId, user.id)
      break

    case '👤 Профиль':
      await showProfileMenu(chatId, user.id)
      break

    case '💎 Подписка':
      await showSubscriptionMenu(chatId, user.id)
      break

    case '🎯 Мои предпочтения':
      await showUserPreferencesMenu(chatId, user.id)
      break

    default:
      return false // Не обработано
  }

  return true // Обработано
}
/**
 * Обработка редактирования приема пищи
 */
async function handleMealEdit(userId: number, chatId: number, dbUserId: number, mealId: number, newDescription: string) {
  try {
    await sendMessage(chatId, "⏳ Анализирую новое описание...")
    
    // Получаем план питания
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', dbUserId)
      .eq('is_active', true)
      .single()
    
    // Анализируем новое описание через OpenAI
    const prompt = `Ты - C.I.D., AI-диетолог. Проанализируй прием пищи клиента.
Описание: "${newDescription}"
Дневной план: ${plan.calories} ккал (Б: ${plan.protein}г, Ж: ${plan.fats}г, У: ${plan.carbs}г)
⚠️ ИСПОЛЬЗУЙ СТАНДАРТНЫЕ ТАБЛИЦЫ БЖУ:
- Тунец запеченный/отварной: ~130-150 ккал/100г, Б: 28-30г, Ж: 1-2г, У: 0г
- Куриная грудка: ~110 ккал/100г, Б: 23г, Ж: 1.2г
- Рис отварной: ~130 ккал/100г, Б: 2.7г, Ж: 0.3г, У: 28г
- Фетакса (сыр фета): ~260 ккал/100г, Б: 16г, Ж: 21г, У: 1г
- Овощи свежие: ~15-20 ккал/100г
- Творог обезжиренный (0-2%): ~70-80 ккал/100г, Б: 16-18г, Ж: 0.5-2г, У: 2-3г
- Греческий йогурт 0%: ~60-70 ккал/100г, Б: 10-11г, Ж: 0-0.5г, У: 4-5г
- Орехи (миндаль, грецкий, кешью): ~600-650 ккал/100г, Б: 15-20г, Ж: 50-60г, У: 10-15г
- Арахис: ~550 ккал/100г, Б: 26г, Ж: 45г, У: 10г
⚠️ ПРИМЕРЫ РАСЧЕТОВ (СТРОГО СЛЕДУЙ):
Пример 1: "Орехи 70г"
- На 100г: 620 ккал, Б:18г, Ж:55г, У:12г
- На 70г: 620*0.7=434 ккал, Б:12.6г, Ж:38.5г, У:8.4г
Пример 2: "Творог 250г"
- На 100г: 75 ккал, Б:17г, Ж:1г, У:2.5г
- На 250г: 187.5 ккал, Б:42.5г, Ж:2.5г, У:6.25г
Задачи:
1. Рассчитай КБЖУ этого приема
2. Распиши детализацию по каждому продукту (название, вес, КБЖУ)
3. Дай краткий комментарий
Верни JSON:
{
  "calories": число,
  "protein": число,
  "fats": число,
  "carbs": число,
  "breakdown": [
    {
      "product": "название продукта",
      "weight": "вес с единицей измерения",
      "calories": число,
      "protein": число,
      "fats": число,
      "carbs": число
    }
  ],
  "comment": "краткий комментарий"
}`
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: 'Ты C.I.D. - AI-диетолог. КРИТИЧЕСКИ ВАЖНО: СТРОГО используй ТОЛЬКО таблицы БЖУ из инструкций для расчетов. НЕ придумывай значения. Для орехов ВСЕГДА: ~620 ккал/100г, Ж:55г (МНОГО жиров!), У:12г (мало углеводов!). Пример: 70г орехов = 434 ккал, Ж:38.5г, У:8.4г. Будь математически точным при умножении на вес.' },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 500
      })
    })
    const data = await response.json()
    console.log('OpenAI response for food editing:', JSON.stringify(data))

    // Парсим JSON с обработкой ошибок
    let rawAnalysis
    try {
      let content = data.choices[0]?.message?.content || ''
      if (!content.trim()) {
        throw new Error('Empty response from API')
      }
      // Очищаем от возможных markdown блоков
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      rawAnalysis = JSON.parse(content)
    } catch (parseError) {
      console.error('JSON parsing error:', parseError)
      console.error('Raw content:', data.choices[0]?.message?.content)
      await sendMessage(chatId, "❌ Не удалось обработать ответ. Попробуй еще раз.", {
        inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]]
      })
      await clearUserState(userId)
      return
    }

    // ⚡ ВАЛИДАЦИЯ И АВТОКОРРЕКЦИЯ КБЖУ
    const validated = validateNutrition(rawAnalysis)
    console.log('Validated nutrition (edit):', JSON.stringify(validated))

    // Используем исправленные значения
    const analysis = {
      ...rawAnalysis,
      calories: validated.calories,
      protein: validated.protein,
      fats: validated.fats,
      carbs: validated.carbs,
      breakdown: validated.breakdown
    }

    // Обновляем запись
    const { error } = await supabase
      .from('food_logs')
      .update({
        description: newDescription,
        calories: analysis.calories,
        protein: analysis.protein,
        fats: analysis.fats,
        carbs: analysis.carbs
      })
      .eq('id', mealId)
      .eq('user_id', dbUserId)

    if (error) {
      throw error
    }

    // Формируем детализацию
    let breakdownText = ''
    if (analysis.breakdown && analysis.breakdown.length > 0) {
      breakdownText = '\n\n📋 Детализация:\n'
      analysis.breakdown.forEach((item: any, index: number) => {
        breakdownText += `\n${index + 1}. ${item.product} (${item.weight})`
        breakdownText += `\n   🔥 ${item.calories} ккал | 🥩 Б: ${item.protein}г | 🥑 Ж: ${item.fats}г | 🍞 У: ${item.carbs}г`
      })
    }

    // Формируем заметки об автокоррекции
    let validationText = ''
    if (validated.corrected && validated.notes.length > 0) {
      validationText = `\n\n⚠️ **Автокоррекция:**\n${validated.notes.join('\n')}`
    }

    const resultText = `✅ Прием пищи обновлен!
🔥 Калории: ${analysis.calories} ккал
🥩 Белки: ${analysis.protein}г
🥑 Жиры: ${analysis.fats}г
🍞 Углеводы: ${analysis.carbs}г${breakdownText}
💬 ${analysis.comment}${validationText}`
    
    await sendMessage(chatId, resultText, {
      inline_keyboard: [
        [{ text: "📝 Управление приемами", callback_data: "manage_meals" }],
        [{ text: "📊 Дневник", callback_data: "diary" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
    
    await clearUserState(userId)
  } catch (error) {
    console.error('Error editing meal:', error)
    await sendMessage(chatId, "❌ Ошибка обновления приема пищи. Попробуй еще раз.")
  }
}
/**
 * Обработка редактирования параметров
 */
async function handleParameterEdit(userId: number, chatId: number, dbUserId: number, param: string, value: string) {
  try {
    if (['calories', 'protein', 'fats', 'carbs', 'water'].includes(param)) {
      // Редактирование КБЖУ
      const { data: currentPlan } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('user_id', dbUserId)
        .eq('is_active', true)
        .single()
      
      const numValue = parseFloat(value)
      if (isNaN(numValue)) {
        await sendMessage(chatId, "❌ Пожалуйста, введи число")
        return
      }
      
      const updates: any = {}
      
      if (param === 'calories') {
        updates.calories = Math.round(numValue)
      } else if (param === 'protein') {
        updates.protein = numValue
        // Пересчитываем калории: Б × 4 + Ж × 9 + У × 4
        const proteinCalories = numValue * 4
        const fatsCalories = currentPlan.fats * 9
        const carbsCalories = currentPlan.carbs * 4
        const totalCalories = proteinCalories + fatsCalories + carbsCalories
        updates.calories = Math.round(totalCalories)
      } else if (param === 'fats') {
        updates.fats = numValue
        // Пересчитываем калории: Б × 4 + Ж × 9 + У × 4
        const proteinCalories = currentPlan.protein * 4
        const fatsCalories = numValue * 9
        const carbsCalories = currentPlan.carbs * 4
        const totalCalories = proteinCalories + fatsCalories + carbsCalories
        updates.calories = Math.round(totalCalories)
      } else if (param === 'carbs') {
        updates.carbs = numValue
        // Пересчитываем калории: Б × 4 + Ж × 9 + У × 4
        const proteinCalories = currentPlan.protein * 4
        const fatsCalories = currentPlan.fats * 9
        const carbsCalories = numValue * 4
        const totalCalories = proteinCalories + fatsCalories + carbsCalories
        updates.calories = Math.round(totalCalories)
      } else if (param === 'water') {
        updates.water = numValue
      }
      
      console.log('Recalculating calories:', {
        param,
        value: numValue,
        currentCalories: currentPlan.calories,
        newCalories: updates.calories
      })
      
      await supabase
        .from('nutrition_plans')
        .update(updates)
        .eq('id', currentPlan.id)
      
      // Получаем обновленный план
      const { data: updatedPlan } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('id', currentPlan.id)
        .single()
      
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', dbUserId)
        .single()
      
      const cardText = formatNutritionCard(updatedPlan, profile)
      await sendMessage(chatId, cardText, nutritionCardKeyboard())
      
    } else if (['name', 'weight', 'height', 'age'].includes(param)) {
      // Редактирование параметров профиля
      const updates: any = {}
      
      if (param === 'name') {
        updates.name = value
      } else if (param === 'weight') {
        const numValue = parseFloat(value)
        if (isNaN(numValue) || numValue < 30 || numValue > 300) {
          await sendMessage(chatId, "❌ Пожалуйста, укажи корректный вес (30-300 кг)")
          return
        }
        updates.current_weight = numValue
      } else if (param === 'height') {
        const numValue = parseFloat(value)
        if (isNaN(numValue) || numValue < 100 || numValue > 250) {
          await sendMessage(chatId, "❌ Пожалуйста, укажи корректный рост (100-250 см)")
          return
        }
        updates.height = numValue
      } else if (param === 'age') {
        const numValue = parseInt(value)
        if (isNaN(numValue) || numValue < 10 || numValue > 120) {
          await sendMessage(chatId, "❌ Пожалуйста, укажи корректный возраст (10-120 лет)")
          return
        }
        updates.age = numValue
      }
      
      await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', dbUserId)
      
      await sendMessage(chatId, "✅ Параметр успешно обновлен!")
    }
    
    await clearUserState(userId)
  } catch (error) {
    console.error('Error editing parameter:', error)
    await sendMessage(chatId, "❌ Ошибка обновления параметра")
  }
}
/**
 * Запись приема пищи
 */
/**
 * Обработка логирования воды
 */
async function handleWaterLogging(userId: number, chatId: number, dbUserId: number, text: string) {
  try {
    await sendMessage(chatId, "💧 Логирую воду...")

    // Парсим количество из текста
    const lowerText = text.toLowerCase()

    let amountMl = 0

    // Ищем миллилитры
    const mlMatch = lowerText.match(/(\d+)\s*(мл|миллилитр)/i)
    if (mlMatch) {
      amountMl = parseInt(mlMatch[1])
    }

    // Ищем литры
    const literMatch = lowerText.match(/(\d+(?:[.,]\d+)?)\s*(л|литр)/i)
    if (literMatch && amountMl === 0) {
      const liters = parseFloat(literMatch[1].replace(',', '.'))
      amountMl = Math.round(liters * 1000)
    }

    // Ищем стандартные емкости
    if (amountMl === 0) {
      if (/(стакан|стак)/i.test(lowerText)) amountMl = 250
      else if (/(бутылк)/i.test(lowerText)) amountMl = 500
      else if (/(кружк|чашк)/i.test(lowerText)) amountMl = 300
    }

    // Если не нашли количество - запрашиваем
    if (amountMl === 0 || amountMl > 5000) {
      await sendMessage(
        chatId,
        `💧 **Сколько воды ты выпил?**\n\n` +
        `Укажи количество:\n` +
        `• В миллилитрах: "500 мл"\n` +
        `• В литрах: "1.5 л"\n` +
        `• Или просто: "стакан", "бутылка"`,
        {
          inline_keyboard: [
            [
              { text: "250 мл", callback_data: "log_water_250" },
              { text: "500 мл", callback_data: "log_water_500" }
            ],
            [
              { text: "1 литр", callback_data: "log_water_1000" },
              { text: "1.5 литра", callback_data: "log_water_1500" }
            ],
            [{ text: "❌ Отмена", callback_data: "cancel_action" }]
          ]
        }
      )
      return
    }

    // Логируем воду
    const { data: result, error } = await supabase
      .rpc('log_water_intake', {
        p_user_id: dbUserId,
        p_amount_ml: amountMl,
        p_note: null
      })

    if (error || !result.success) {
      throw new Error('Failed to log water')
    }

    // Формируем сообщение
    const todayTotalL = (result.today_total_ml / 1000).toFixed(1)
    const targetL = (result.target_ml / 1000).toFixed(1)
    const remainingL = (result.remaining_ml / 1000).toFixed(1)
    const progressPercent = result.progress_percent

    let progressBar = ''
    const filledSegments = Math.floor(progressPercent / 10)
    for (let i = 0; i < 10; i++) {
      progressBar += i < filledSegments ? '💧' : '⚪'
    }

    let messageText = `✅ **Вода записана!**\n\n`
    messageText += `💧 **+${amountMl} мл**\n\n`
    messageText += `📊 **Прогресс за сегодня:**\n`
    messageText += `${progressBar} ${progressPercent}%\n\n`
    messageText += `💧 Выпито: **${todayTotalL}л** / ${targetL}л\n`

    if (result.remaining_ml > 0) {
      messageText += `📌 Осталось: **${remainingL}л**`
    } else {
      messageText += `🎉 **Цель достигнута!** Отличная работа!`
    }

    await sendMessage(chatId, messageText, {
      inline_keyboard: [
        [
          { text: "💧 Еще воды", callback_data: "quick_log_water" },
          { text: "📊 Статистика", callback_data: "water_stats" }
        ],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })

  } catch (error) {
    console.error('Error logging water:', error)
    await sendMessage(chatId, "❌ Ошибка записи воды. Попробуй еще раз.")
  }
}

async function handleFoodLogging(userId: number, chatId: number, dbUserId: number, foodDescription: string, clarificationAttempt: number = 0) {
  try {
    await sendMessage(chatId, "⏳ Анализирую твой прием пищи...")
    
    // Получаем план питания
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', dbUserId)
      .eq('is_active', true)
      .single()
    
    // Получаем записи за сегодня
    const today = new Date().toISOString().split('T')[0]
    const { data: todayLogs } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', dbUserId)
      .gte('logged_at', `${today}T00:00:00`)
      .order('logged_at', { ascending: false })
    
    // Анализируем через OpenAI
    const clarificationNote = clarificationAttempt > 0 
      ? '\n⚠️ ВАЖНО: Клиент уже дал уточнение. Работай с той информацией, что есть. НЕ запрашивай дополнительные уточнения. Используй стандартные порции для расчета КБЖУ.'
      : `\n1. ВНИМАТЕЛЬНО проверь КАЖДЫЙ продукт: если рядом с ним УЖЕ указаны граммы/мл/штуки - вес есть!
2. Для блюд с указанием объема ("тарелка супа", "салат 350г") - используй эти данные для расчета
3. Если у продукта указан вес (даже приблизительный) - рассчитывай КБЖУ, не запрашивай уточнение
4. Запрашивай уточнение ТОЛЬКО если совсем нет информации о количестве
Примеры:
- "банан 150г, яблоко 200г" → все веса есть, считай
- "тарелка супа 250мл, салат 350г" → все веса есть, считай  
- "банан, яблоко" → спроси: "Укажите примерный вес"`
    
    const prompt = `Ты - C.I.D., AI-диетолог. Проанализируй прием пищи клиента.
Описание: "${foodDescription}"
Дневной план: ${plan.calories} ккал (Б: ${plan.protein}г, Ж: ${plan.fats}г, У: ${plan.carbs}г)
Задачи:${clarificationNote}
4. Рассчитай КБЖУ этого приема
5. Распиши детализацию по каждому продукту (название, вес, КБЖУ)
6. Дай краткий комментарий (вписывается ли в план)
КРИТИЧЕСКИ ВАЖНО:
- ВСЕГДА рассчитывай КБЖУ если есть ХОТЬ КАКАЯ-ТО информация о количестве/весе
- Игнорируй опечатки в словах (например: "окурцов" = огурцов, "милилитров" = миллилитров)
- Для блюд используй стандартные рецепты (суп овощной ~40-50 ккал/100г, салат из овощей ~30-40 ккал/100г)
- Если указан объем (250мл, 350г) - это достаточно для расчета, не запрашивай уточнение!
⚠️ ИСПОЛЬЗУЙ СТАНДАРТНЫЕ ТАБЛИЦЫ БЖУ:
- Тунец запеченный/отварной: ~130-150 ккал/100г, Б: 28-30г, Ж: 1-2г, У: 0г
- Тунец консервированный в масле: ~200 ккал/100г
- Куриная грудка: ~110 ккал/100г, Б: 23г, Ж: 1.2г
- Рис отварной: ~130 ккал/100г, Б: 2.7г, Ж: 0.3г, У: 28г
- Фетакса (сыр фета): ~260 ккал/100г, Б: 16г, Ж: 21г, У: 1г
- Овощи свежие (огурцы/помидоры): ~15-20 ккал/100г
- Творог обезжиренный (0-2%): ~70-80 ккал/100г, Б: 16-18г, Ж: 0.5-2г, У: 2-3г
- Греческий йогурт 0%: ~60-70 ккал/100г, Б: 10-11г, Ж: 0-0.5г, У: 4-5г
- Орехи (миндаль, грецкий, кешью): ~600-650 ккал/100г, Б: 15-20г, Ж: 50-60г, У: 10-15г
- Арахис: ~550 ккал/100г, Б: 26г, Ж: 45г, У: 10г
⚠️ БУДЬ ПОСЛЕДОВАТЕЛЬНЫМ:
- Одинаковые продукты ВСЕГДА должны иметь одинаковую калорийность на 100г
- Используй точные данные из таблиц БЖУ, не придумывай значения
- Для "запеченного тунца" ВСЕГДА используй ~130-150 ккал/100г
⚠️ НЕКАЛОРИЙНЫЕ НАПИТКИ (0 калорий):
- Вода (обычная, минеральная, газированная) - ВСЕГДА 0 калорий
- Чай заваренный без сахара и молока - ВСЕГДА 0 калорий
- Кофе заваренный/эспрессо без сахара и молока (ЖИДКИЙ напиток) - ВСЕГДА 0 калорий
- НЕ ВКЛЮЧАЙ эти напитки в breakdown и не учитывай в общей сумме КБЖУ
⚠️ НИЗКОКАЛОРИЙНЫЕ ПРОДУКТЫ (учитывать):
- Растворимый кофе (ПОРОШОК): ~3-5 ккал на чайную ложку
- Чайные листья/порошок: минимальные калории, но учитывай если указан вес
- ВАЖНО: Если пользователь указал "растворимый кофе 2 ч.л." - это ПРОДУКТ, а не напиток! Считай калории!
Примеры:
✅ "тарелка супа 250мл, салат 350г" → есть вес, считай КБЖУ
✅ "банан 150г" → есть вес, считай
✅ "порция курицы 200г" → есть вес, считай
✅ "яйца 2 шт, кофе 200 мл" → считай только яйца, заваренный кофе игнорируй (0 ккал)
✅ "растворимый кофе 2 ч.л." → считай! (~8-10 ккал)
✅ "вода 500 мл" → не считай, верни need_clarification
❌ "банан" → нет веса, запроси уточнение
⚠️ ФОРМАТ ОТВЕТА: Валидный JSON. В текстовых полях используй только одну строку без переносов!
Верни JSON:
{
  "need_clarification": true/false,
  "clarification_question": "вопрос",
  "calories": число,
  "protein": число,
  "fats": число,
  "carbs": число,
  "breakdown": [
    {"product": "название", "weight": "вес", "calories": число, "protein": число, "fats": число, "carbs": число}
  ],
  "comment": "краткая фраза"
}`
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: 'Ты C.I.D. - AI-диетолог. КРИТИЧЕСКИ ВАЖНО: СТРОГО используй ТОЛЬКО таблицы БЖУ из инструкций для расчетов. НЕ придумывай значения. Для орехов ВСЕГДА: ~620 ккал/100г, Ж:55г (МНОГО жиров!), У:12г (мало углеводов!). Пример: 70г орехов = 434 ккал, Ж:38.5г, У:8.4г. Будь математически точным при умножении на вес. ВАЖНО: Возвращай ТОЛЬКО валидный JSON. В текстовых полях НЕ используй переносы строк - заменяй их на пробелы. Все кавычки внутри строк экранируй.' },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 1000  // Увеличено для больших списков продуктов
      })
    })
    const data = await response.json()
    console.log('OpenAI response for food logging:', JSON.stringify(data))

    // Парсим JSON с обработкой ошибок
    let rawAnalysis
    try {
      let content = data.choices[0].message.content
      // Очищаем от возможных markdown блоков
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      rawAnalysis = JSON.parse(content)
      console.log('Parsed analysis:', JSON.stringify(rawAnalysis))
    } catch (parseError) {
      console.error('JSON parsing error:', parseError)
      console.error('Raw content:', data.choices[0].message.content)

      await sendMessage(chatId, "❌ Не удалось обработать ответ. Попробуй описать проще или разбить на несколько приемов пищи.", {
        inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]]
      })
      await clearUserState(userId)
      return
    }

    // ⚡ ВАЛИДАЦИЯ И АВТОКОРРЕКЦИЯ КБЖУ
    const validated = validateNutrition(rawAnalysis)
    console.log('Validated nutrition:', JSON.stringify(validated))

    // Используем исправленные значения
    const analysis = {
      ...rawAnalysis,
      calories: validated.calories,
      protein: validated.protein,
      fats: validated.fats,
      carbs: validated.carbs,
      breakdown: validated.breakdown
    }

    // 🚰 ПРОВЕРКА: Если calories === 0 и нет breakdown - это только некалорийные напитки
    if ((!analysis.calories || analysis.calories === 0) && (!analysis.breakdown || analysis.breakdown.length === 0)) {
      console.log('Zero calories and no breakdown - only zero-calorie drinks')
      await clearUserState(userId)
      await sendMessage(chatId, "🤔 Похоже, ты указал только напитки без калорий (вода, заваренный чай/кофе). Напиши, что ты поел/выпил из еды с калориями?", {
        inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]]
      })
      return
    }

    // 🚰 ФИЛЬТРАЦИЯ НЕКАЛОРИЙНЫХ НАПИТКОВ
    // Исключаем продукты с 0 калорий из breakdown (вода, чай, кофе без добавок)
    if (analysis.breakdown && Array.isArray(analysis.breakdown)) {
      const filteredBreakdown = analysis.breakdown.filter((item: any) => {
        const hasCalories = item.calories && item.calories > 0
        if (!hasCalories) {
          console.log('Filtering out zero-calorie item:', item.product)
        }
        return hasCalories
      })

      // Если после фильтрации ничего не осталось - запрашиваем уточнение
      if (filteredBreakdown.length === 0) {
        console.log('All items were zero-calorie, requesting clarification')
        await clearUserState(userId)
        await sendMessage(chatId, "🤔 Похоже, ты указал только напитки без калорий (вода, заваренный чай/кофе). Напиши, что ты поел/выпил из еды с калориями?", {
          inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]]
        })
        return
      }

      analysis.breakdown = filteredBreakdown

      // Пересчитываем сумму КБЖУ на основе отфильтрованного breakdown (для надежности)
      const recalculated = filteredBreakdown.reduce((sum: any, item: any) => ({
        calories: sum.calories + (item.calories || 0),
        protein: sum.protein + (item.protein || 0),
        fats: sum.fats + (item.fats || 0),
        carbs: sum.carbs + (item.carbs || 0)
      }), { calories: 0, protein: 0, fats: 0, carbs: 0 })

      // Округляем до 1 знака после запятой
      analysis.calories = Math.round(recalculated.calories * 10) / 10
      analysis.protein = Math.round(recalculated.protein * 10) / 10
      analysis.fats = Math.round(recalculated.fats * 10) / 10
      analysis.carbs = Math.round(recalculated.carbs * 10) / 10

      console.log('Recalculated totals after filtering zero-calorie items:', recalculated)
    }

    // Разрешаем уточнение только один раз
    if (rawAnalysis.need_clarification && clarificationAttempt === 0) {
      // ВАЖНО: сохраняем исходное описание еды!
      await setUserState(userId, 'logging_food', { 
        clarification_attempt: 1,
        original_description: foodDescription
      })
      await sendMessage(chatId, `❓ ${analysis.clarification_question}`, {
        inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]]
      })
      return
    }
    
    // Сохраняем запись и получаем ID
    const { data: savedLog, error: saveError } = await supabase
      .from('food_logs')
      .insert({
        user_id: dbUserId,
        description: foodDescription, // Это уже полное описание (исходное + уточнение)
        calories: analysis.calories,
        protein: analysis.protein,
        fats: analysis.fats,
        carbs: analysis.carbs,
        logged_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (saveError) {
      throw saveError
    }

    // 🔥 STREAK SYSTEM: Обновляем streak пользователя
    let streakInfo: any = null
    try {
      const { data: streakData, error: streakError } = await supabase
        .rpc('update_user_streak', { p_user_id: dbUserId })
        .single()

      if (!streakError && streakData) {
        streakInfo = streakData
        console.log(`✅ Streak updated for user ${dbUserId}:`, streakInfo)
      }
    } catch (error) {
      console.error('Error updating streak:', error)
      // Не падаем если streak не обновился - это не критично
    }

    // Формируем детализацию по продуктам
    let breakdownText = ''
    if (analysis.breakdown && analysis.breakdown.length > 0) {
      breakdownText = '\n\n📋 Детализация:\n'
      analysis.breakdown.forEach((item: any, index: number) => {
        breakdownText += `\n${index + 1}. ${item.product} (${item.weight})`
        breakdownText += `\n   🔥 ${item.calories} ккал | 🥩 Б: ${item.protein}г | 🥑 Ж: ${item.fats}г | 🍞 У: ${item.carbs}г`
      })
    }
    
    const now = new Date()
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

    // Формируем streak информацию
    let streakText = ''
    if (streakInfo) {
      streakText = `\n\n🔥 **Streak: ${streakInfo.current_streak} ${streakInfo.current_streak === 1 ? 'день' : streakInfo.current_streak < 5 ? 'дня' : 'дней'}!**`

      if (streakInfo.is_new_record) {
        streakText += ` 🎉 Новый рекорд!`
      }

      // Добавляем новые достижения
      if (streakInfo.earned_achievements && streakInfo.earned_achievements.length > 0) {
        streakText += `\n\n🏆 **Новые достижения:**\n${streakInfo.earned_achievements.join('\n')}`
      }
    }

    // Формируем заметки об автокоррекции
    let validationText = ''
    if (validated.corrected && validated.notes.length > 0) {
      validationText = `\n\n⚠️ **Автокоррекция:**\n${validated.notes.join('\n')}`
    }

    const resultText = `✅ **Прием пищи записан!**
📝 ${foodDescription}
🔥 ${analysis.calories} ккал | 🥩 Б: ${analysis.protein}г | 🥑 Ж: ${analysis.fats}г | 🍞 У: ${analysis.carbs}г${breakdownText}
⏰ ${timeStr}
💬 ${analysis.comment}${validationText}${streakText}
💡 **Совет:** В следующий раз можешь просто 📸 сфотографировать еду!`
    
    // 🔥 ОПТИМИЗИРОВАННЫЕ Post-action buttons
    await sendMessage(chatId, resultText, afterFoodLogKeyboard(savedLog.id))
    
    await clearUserState(userId)
  } catch (error) {
    console.error('Error logging food:', error)
    await sendMessage(chatId, "❌ Ошибка записи. Попробуй еще раз.")
  }
}
/**
 * Обработка запроса рецепта
 */
async function handleRecipeRequest(userId: number, chatId: number, dbUserId: number, request: string, messageId?: number) {
  try {
    console.log(`🤖 handleRecipeRequest called for user ${dbUserId}`)

    // ⚡ RATE LIMITING CHECK
    const rateLimit = await checkRateLimit(dbUserId, 30, 1) // 30 запросов в минуту
    if (!rateLimit.allowed) {
      console.warn(`🚫 Rate limit exceeded for user ${dbUserId}. Retry after ${rateLimit.retryAfter}s`)
      await sendMessage(
        chatId,
        `⏱ Слишком много запросов! Пожалуйста, подожди ${rateLimit.retryAfter} секунд.\n\nЭто защита от спама для всех пользователей. 🙏`,
        undefined,
        'Markdown',
        messageId
      )
      return
    }
    console.log(`✅ Rate limit OK. Remaining: ${rateLimit.remaining}/30`)

    // Отправляем "думающее" сообщение как reply на сообщение пользователя
    await sendMessage(chatId, "🤔 Думаю...", undefined, 'Markdown', messageId)

    // 1. Извлекаем предпочтения из текущего запроса и сохраняем их
    console.log(`🔍 Extracting preferences from text: "${request}"`)
    const extractedPrefs = await extractPreferencesFromText(request)
    console.log(`Found ${extractedPrefs.length} preferences:`, extractedPrefs)
    
    for (const pref of extractedPrefs) {
      await saveUserPreference(
        dbUserId,
        pref.type as 'allergy' | 'intolerance' | 'dislike' | 'exclude' | 'preference',
        pref.item
      )
    }
    
    // 2. Получаем все предпочтения пользователя
    console.log(`📋 Loading all user preferences...`)
    const userPreferences = await getUserPreferences(dbUserId)
    console.log(`User has ${userPreferences.length} saved preferences`)
    
    // 3. Получаем историю диалога (последние 30 сообщений для полноценного контекста)
    const chatHistory = await getChatHistory(dbUserId, 30)
    console.log(`📚 Chat history loaded: ${chatHistory.length} messages`)
    
    // 4. Получаем план и записи за сегодня
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', dbUserId)
      .eq('is_active', true)
      .single()
    
    const today = new Date().toISOString().split('T')[0]
    const { data: todayLogs } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', dbUserId)
      .gte('logged_at', `${today}T00:00:00`)
    
    // Считаем съеденное
    const consumed = todayLogs?.reduce((acc, log) => ({
      calories: acc.calories + (log.calories || 0),
      protein: acc.protein + (log.protein || 0),
      fats: acc.fats + (log.fats || 0),
      carbs: acc.carbs + (log.carbs || 0)
    }), { calories: 0, protein: 0, fats: 0, carbs: 0 }) || { calories: 0, protein: 0, fats: 0, carbs: 0 }
    
    // Проверяем последний прием
    const lastMeal = todayLogs?.[0]
    const timeSinceLastMeal = lastMeal ? (Date.now() - new Date(lastMeal.logged_at).getTime()) / (1000 * 60) : 999
    
    // 5. Формируем информацию о предпочтениях для промпта
    let preferencesText = ''
    if (userPreferences.length > 0) {
      preferencesText = '\n\n🚫 ВАЖНЫЕ ОГРАНИЧЕНИЯ ПОЛЬЗОВАТЕЛЯ:\n'
      const allergies = userPreferences.filter(p => p.preference_type === 'allergy')
      const intolerances = userPreferences.filter(p => p.preference_type === 'intolerance')
      const excludes = userPreferences.filter(p => p.preference_type === 'exclude')
      
      if (allergies.length > 0) {
        preferencesText += `- Аллергия: ${allergies.map(p => p.item).join(', ')}\n`
      }
      if (intolerances.length > 0) {
        preferencesText += `- Непереносимость: ${intolerances.map(p => p.item).join(', ')}\n`
      }
      if (excludes.length > 0) {
        preferencesText += `- Исключить из рациона: ${excludes.map(p => p.item).join(', ')}\n`
      }
      
      // Специальная обработка для лактозы
      if (intolerances.some(p => p.item.includes('лактоз') || p.item.includes('молок'))) {
        preferencesText += '\n⚠️ При непереносимости лактозы: МОЖНО творог и твердые сыры (в них почти нет лактозы), но НЕЛЬЗЯ молоко, сливки, мягкие сыры, йогурты.\n'
      }
    }
    
    // 6. ДЕТЕКТОР КОРРЕКТИРОВОК - анализируем последние сообщения пользователя на наличие исключений/замен
    const recentUserMessages = chatHistory.filter(msg => msg.role === 'user').slice(-5) // Последние 5 сообщений пользователя
    const excludedProducts: string[] = []
    const replacements: Array<{from: string, to: string}> = []

    for (const msg of recentUserMessages) {
      // Детектим исключения: "убери X", "без X", "не хочу X", "не люблю X"
      const excludePatterns = [
        /убер[иь]\s+([а-яё]+)/gi,
        /без\s+([а-яё]+)/gi,
        /не\s+(?:хочу|люблю|ем)\s+([а-яё]+)/gi
      ]

      for (const pattern of excludePatterns) {
        const matches = [...msg.content.matchAll(pattern)]
        for (const match of matches) {
          if (match[1]) {
            excludedProducts.push(match[1])
          }
        }
      }

      // Детектим замены: "замени X на Y", "вместо X дай Y"
      const replaceMatch = msg.content.match(/замен[иь]\s+([а-яё]+)(?:\s+на\s+([а-яё]+))?/i)
      if (replaceMatch) {
        if (replaceMatch[2]) {
          replacements.push({ from: replaceMatch[1], to: replaceMatch[2] })
        } else {
          excludedProducts.push(replaceMatch[1])
        }
      }
    }

    console.log(`🔍 Detected exclusions:`, excludedProducts)
    console.log(`🔍 Detected replacements:`, replacements)

    // 7. Извлекаем ВСЮ историю для анализа контекста
    const lastAssistantMessage = chatHistory.length > 0
      ? chatHistory.slice().reverse().find(msg => msg.role === 'assistant')
      : null

    let contextAnalysis = ''

    // КРИТИЧЕСКИ ВАЖНО: Если есть исключения или запрос "пришли всё", добавляем ЖИРНОЕ ПРЕДУПРЕЖДЕНИЕ
    const isRequestingFullPlan = request.toLowerCase().match(/(пришли|покажи|дай).*(весь|всё|полн|целиком|рацион|план)/i)

    if ((excludedProducts.length > 0 || replacements.length > 0) && isRequestingFullPlan) {
      contextAnalysis = `\n\n🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО - ПОЛЬЗОВАТЕЛЬ ЗАПРОСИЛ ПОЛНЫЙ ПЛАН С УЧЕТОМ КОРРЕКТИРОВОК! 🚨🚨🚨

⛔ ИСКЛЮЧЕННЫЕ ПРОДУКТЫ (НИКОГДА НЕ ИСПОЛЬЗУЙ ИХ):
${excludedProducts.length > 0 ? excludedProducts.map(p => `- ${p}`).join('\n') : '- нет'}

🔄 ЗАМЕНЫ ПРОДУКТОВ:
${replacements.length > 0 ? replacements.map(r => `- ${r.from} → ${r.to}`).join('\n') : '- нет'}

📋 ЧТО ДЕЛАТЬ:
1. Найди ПОЛНЫЙ план питания из своих предыдущих сообщений (ищи 🕐 и приемы пищи)
2. УДАЛИ все продукты из списка исключенных
3. ПРИМЕНИ все замены из списка
4. Покажи ВЕСЬ скорректированный план целиком
5. НЕ СОЗДАВАЙ новый план! Используй старый с корректировками!

`
    }

    if (lastAssistantMessage) {
      // Проверяем, был ли составлен план в предыдущих сообщениях
      const hasMealPlan = lastAssistantMessage.content.includes('🕐') && lastAssistantMessage.content.includes('📊 Итого')

      contextAnalysis += `\n🔍 АНАЛИЗ ПРЕДЫДУЩЕГО КОНТЕКСТА:
${hasMealPlan ? '⚠️ В ПРЕДЫДУЩИХ СООБЩЕНИЯХ ТЫ УЖЕ СОСТАВИЛ ПЛАН ПИТАНИЯ!' : ''}

ТВОЙ ПОСЛЕДНИЙ ОТВЕТ содержал:
${lastAssistantMessage.content.substring(0, 1200)}${lastAssistantMessage.content.length > 1200 ? '...' : ''}

🚨 ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. ПРОВЕРЬ всю историю диалога - там могут быть корректировки!
2. Если пользователь спрашивает "про какой X" - ищи X в предыдущих ответах
3. НИКОГДА не отрицай упоминание, если оно есть в истории!
`
    }
    
    // 8. Составляем системное сообщение с контекстом
    const systemMessage = `Ты - C.I.D., AI-диетолог. Помогаешь клиенту с питанием.
📊 ИНФОРМАЦИЯ О КЛИЕНТЕ:
Дневной план: ${plan?.calories || 'не установлен'} ккал (Б: ${plan?.protein || 0}г, Ж: ${plan?.fats || 0}г, У: ${plan?.carbs || 0}г)
Съедено сегодня: ${consumed.calories} ккал (Б: ${consumed.protein}г, Ж: ${consumed.fats}г, У: ${consumed.carbs}г)
Последний прием: ${Math.round(timeSinceLastMeal)} минут назад${preferencesText}${contextAnalysis}

🚫 КРИТИЧЕСКИ ВАЖНО - ПИЩЕВЫЕ ОГРАНИЧЕНИЯ:
${userPreferences.length > 0 ? `
- Ты ОБЯЗАН соблюдать все ограничения пользователя!
- НИКОГДА не предлагай продукты из списка ограничений!
- Перед составлением плана ВСЕГДА проверяй что не используешь исключенные продукты!
- Все предпочтения выше запомнены НАВСЕГДА - учитывай их в КАЖДОМ ответе!
` : '- Ограничений пока нет, но если пользователь упомянет - запомни это!'}

📝 ТВОИ ЗАДАЧИ:
1. ВСЕГДА проверяй ограничения пользователя ПЕРЕД составлением плана - это критически важно!
2. Если прием был недавно (<2ч) - предложи перекус/воду или спроси про эмоциональный голод
3. Если запрос про меню на день/неделю - составь план СТРОГО в рамках дневного плана КБЖУ
4. Иначе - предложи рецепт с учетом остатка КБЖУ и ограничений
5. Запоминай контекст предыдущих сообщений - это непрерывный диалог

🔄 ВАЖНО - РАБОТА С КОРРЕКТИРОВКАМИ:
- Если пользователь говорит "замени X", "убери Y", "добавь Z" БЕЗ слов "план на день" - это КОРРЕКТИРОВКА
- НЕ составляй новый полный план! Просто замени/убери/добавь ОДИН конкретный продукт
- Пример: "Мед замени" → замени ТОЛЬКО мед на альтернативу, не переписывай весь план
- Пример: "Авокадо тоже убери" → убери ТОЛЬКО авокадо, оставь остальное
- Покажи только ИЗМЕНЕННЫЙ прием пищи с новыми КБЖУ
- **КРИТИЧЕСКИ ВАЖНО**: Если после корректировок пользователь просит "пришли всё целиком", "покажи полностью", "весь план" - НЕ создавай НОВЫЙ план!
  ОБЯЗАТЕЛЬНО возьми ВСЕ приемы пищи из СВОИХ ПРЕДЫДУЩИХ сообщений в истории диалога, примени ВСЕ корректировки (замены/удаления) и покажи ОБНОВЛЕННЫЙ план с учетом ВСЕХ изменений
- Если пользователь явно просит "новый план", "другой рацион", "распиши заново" - только тогда составь полностью новый план

📏 ИЗМЕНЕНИЕ ПОРЦИЙ:
- "Давай порции увеличим" / "Побольше" / "Увеличь порции" → УВЕЛИЧЬ порции всех блюд на 20-30%
- "Уменьши порции" / "Поменьше" → УМЕНЬШИ порции на 20-30%
- "Везде по суть" (после вопроса о порциях) → применить изменение ко ВСЕМ приемам пищи
- ПЕРЕСЧИТАЙ итоговые КБЖУ после изменения порций
- Покажи ОБНОВЛЕННЫЙ план с новыми порциями и КБЖУ

🚨 КРИТИЧЕСКИ ВАЖНО ПРИ СОСТАВЛЕНИИ МЕНЮ НА ДЕНЬ:
- ИТОГОВЫЕ КБЖУ ДОЛЖНЫ СОВПАДАТЬ С ДНЕВНЫМ ПЛАНОМ (±50 ккал)
- План: ${plan?.calories || 0} ккал, Б: ${plan?.protein || 0}г, Ж: ${plan?.fats || 0}г, У: ${plan?.carbs || 0}г
- НЕ превышай эти значения! Распределяй калории между приемами пищи
- В конце ОБЯЗАТЕЛЬНО покажи итоговые КБЖУ и сравни с планом

⚠️ ВАЖНО: 
- В ответе клиенту НЕ упоминай точные цифры минут/часов с последнего приема
- Говори обобщенно: "недавно поел", "давно не ел", "уже пора перекусить"
- При составлении планов указывай время приема пищи
- Если пользователь упоминает НОВЫЕ ограничения (говорит "не ем X", "не хочу Y", "замени Z"), 
  ОБЯЗАТЕЛЬНО подтверди: "📋 Запомнил, [продукт] больше не буду предлагать!"

🎯 ОБРАБОТКА УТОЧНЯЮЩИХ ВОПРОСОВ (анафоры):
- "Про какой X?" → Ищи X в своем предыдущем ответе и отвечай конкретно
- "Что за X?" → Давай детали про X из предыдущего плана
- "Расскажи рецепт" → Если упомянул блюдо/соус - дай рецепт именно его
- "А соус?" → Если упоминал соус - расскажи про него
- "Какой именно?" → Уточни что конкретно из предыдущего ответа
- НИКОГДА не отрицай упоминание, если оно есть в предыдущем ответе!
📱 ФОРМАТИРОВАНИЕ ДЛЯ TELEGRAM:
- НЕ используй markdown заголовки (####, ###, ##)
- Используй эмодзи для выделения разделов: 🍽️, ☀️, 🌆, 🌙, 📊, 🔥
- Для приемов пищи используй периоды дня БЕЗ точного времени:
  • ☀️ Утро - Завтрак
  • 🌞 День - Обед
  • 🌆 Вечер - Ужин
  • 🍎 Перекус
- Для КБЖУ используй: 🔥 600 ккал (Б: 50г, Ж: 15г, У: 40г)
- Для списков используй эмодзи: • или -
- НЕ добавляй лишние пустые строки между разделами
- Максимум 1 пустая строка между приемами пищи
- Используй жирный текст **только** для важных моментов
- Делай текст компактным и читаемым
ПРИМЕР ПРАВИЛЬНОГО ФОРМАТИРОВАНИЯ:
☀️ Утро - Завтрак
• Овсянка с ягодами - 50г
• Миндаль - 15г
🔥 400 ккал (Б: 10г, Ж: 15г, У: 60г)
🌞 День - Обед
• Куриное филе - 150г
• Брокколи - 100г
🔥 500 ккал (Б: 60г, Ж: 15г, У: 30г)
📊 Итого: 900 ккал`
    
    // 9. Формируем массив сообщений с историей
    const messages: Array<{role: string, content: string}> = [
      { role: 'system', content: systemMessage }
    ]

    // Добавляем историю диалога
    if (chatHistory.length > 0) {
      messages.push(...chatHistory)
      console.log(`📝 Added ${chatHistory.length} history messages to context`)
    } else {
      console.log('📝 No chat history found - starting fresh conversation')
    }

    // Добавляем текущий запрос пользователя
    messages.push({ role: 'user', content: request })
    console.log(`📨 Total messages sent to OpenAI: ${messages.length} (1 system + ${chatHistory.length} history + 1 current)`)

    // 10. Проверяем кеш (только для простых запросов без истории)
    let recommendation: string = ''
    let cacheHit = false

    // Кешируем только простые запросы без сложного контекста
    const shouldCache = chatHistory.length === 0 && request.length < 200
    let cacheKey = ''

    if (shouldCache) {
      // Генерируем ключ кеша на основе запроса и базовой информации
      cacheKey = generateCacheKey('recipe', {
        request: request.toLowerCase().trim(),
        calories: plan?.calories || 0,
        preferences: userPreferences.map(p => p.item).sort()
      })

      // Проверяем кеш
      const cachedResponse = await getFromCache(cacheKey)
      if (cachedResponse) {
        recommendation = cachedResponse
        cacheHit = true
        console.log(`💰 CACHE HIT! Saved OpenAI call for: "${request.substring(0, 50)}..."`)
      }
    }

    // Если нет в кеше - вызываем OpenAI с retry
    if (!cacheHit) {
      console.log(`🌐 CACHE MISS - calling OpenAI API...`)

      const data = await callOpenAIWithRetry(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-5-nano',
            messages: messages,
            max_completion_tokens: 2500 // Увеличено для полноценных развернутых ответов с рационами
          })
        },
        3, // maxRetries
        30000 // timeout 30s
      )

      recommendation = data.choices[0].message.content

      // Сохраняем в кеш (если это был простой запрос)
      if (shouldCache && cacheKey) {
        await saveToCache(
          cacheKey,
          'recipe',
          { request, calories: plan?.calories, preferences: userPreferences.map(p => p.item) },
          recommendation,
          86400 // TTL 24 часа для рецептов (они меняются реже)
        )
      }
    }

    // 11. Сохраняем сообщения в историю диалога
    console.log(`💾 Saving user message to chat history (length: ${request.length} chars)`)
    await saveChatMessage(dbUserId, 'user', request)
    console.log(`💾 Saving assistant response to chat history (length: ${recommendation.length} chars)`)
    await saveChatMessage(dbUserId, 'assistant', recommendation)

    // 12. Определяем тип ответа (рацион или один рецепт)
    const mealMatches = recommendation.match(/(завтрак|обед|ужин|перекус):/gi)
    const hasMultipleMeals = mealMatches ? mealMatches.length >= 2 : false

    // 13. Отправляем ответ пользователю с кнопками сохранения (как reply на его сообщение)
    await sendMessage(
      chatId,
      `📋 ${recommendation}`,
      aiResponseActionsKeyboard(hasMultipleMeals),
      'Markdown',
      messageId
    )
    
    // НЕ очищаем state - пользователь остается в режиме диалога
    // Он может просто продолжить писать, диалог идет непрерывно
    // Выход через кнопку "🔙 Назад" или "🏠 Главное меню" на клавиатуре
  } catch (error) {
    console.error('Error handling recipe request:', error)
    await sendMessage(chatId, "❌ Ошибка. Попробуй еще раз.", undefined, 'Markdown', messageId)
  }
}
/**
 * Обработка голосовых сообщений
 */
async function handleVoiceMessage(message: TelegramMessage) {
  const userId = message.from.id
  const chatId = message.chat.id
  
  try {
    await sendMessage(chatId, "🎤 Обрабатываю голосовое сообщение...")
    
    // Получаем информацию о файле
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_DEV}/getFile?file_id=${message.voice!.file_id}`
    )
    const fileData = await fileResponse.json()
    
    if (!fileData.ok) {
      throw new Error('Failed to get file info')
    }
    
    // Скачиваем файл
    const filePath = fileData.result.file_path
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN_DEV}/${filePath}`
    const audioResponse = await fetch(fileUrl)
    const audioBuffer = await audioResponse.arrayBuffer()
    
    // Преобразуем в Blob
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' })
    
    // Отправляем в OpenAI Whisper для транскрипции
    const formData = new FormData()
    formData.append('file', audioBlob, 'voice.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')
    
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData
    })
    
    const transcription = await whisperResponse.json()
    
    if (!transcription.text) {
      throw new Error('Failed to transcribe audio')
    }
    
    console.log('Voice transcribed:', transcription.text)
    
    // Обрабатываем транскрибированный текст как обычное текстовое сообщение
    const textMessage: TelegramMessage = {
      ...message,
      text: transcription.text
    }
    
    await handleTextMessage(textMessage)
    
  } catch (error) {
    console.error('Error handling voice message:', error)
    await sendMessage(chatId, "❌ Ошибка обработки голосового сообщения. Попробуй написать текстом.")
  }
}
/**
 * Функция для получения URL фото
 */
async function getPhotoUrl(fileId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_DEV}/getFile?file_id=${fileId}`
    )
    const data = await response.json()
    
    if (data.ok && data.result.file_path) {
      return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN_DEV}/${data.result.file_path}`
    }
    return null
  } catch (error) {
    console.error('Error getting photo URL:', error)
    return null
  }
}
/**
 * Анализ фото с едой через GPT-4 Vision
 */
async function analyzeFoodPhoto(photoUrl: string, caption?: string): Promise<any> {
  const prompt = `Проанализируй это фото еды и определи:
1. Какие продукты/блюда на фото
2. Примерный вес/объем каждого продукта в граммах
3. Калории, белки, жиры, углеводы для каждого продукта
${caption ? `Дополнительная информация от пользователя: ${caption}` : ''}
ВАЖНО:
- Это примерная оценка на основе визуального анализа. Точность может быть невысокой.
- НЕ ВКЛЮЧАЙ некалорийные напитки (вода, заваренный чай/кофе) в items и total
- Для таких напитков делай примечание в notes
- УЧИТЫВАЙ растворимый кофе/чай в порошке если виден на фото (~5 ккал на чайную ложку)
Ответь в формате JSON:
{
  "items": [
    {
      "name": "название продукта",
      "weight": число_в_граммах,
      "calories": число,
      "protein": число,
      "fats": число,
      "carbs": число
    }
  ],
  "total": {
    "calories": число,
    "protein": число,
    "fats": число,
    "carbs": число
  },
  "confidence": "low/medium/high",
  "notes": "дополнительные заметки"
}`
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: photoUrl
              }
            }
          ]
        }
      ],
      max_completion_tokens: 1000,
    })
  })
  
  const data = await response.json()
  let content = data.choices[0].message.content
  
  // Очищаем от markdown блоков (```json ... ```)
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  
  try {
    return JSON.parse(content)
  } catch (error) {
    console.error('Error parsing GPT response:', error)
    console.error('Content:', content)
    throw new Error('Не удалось распознать содержимое фото. Попробуй еще раз.')
  }
}
/**
 * Обработка фото с едой
 */
async function handlePhotoMessage(message: TelegramMessage) {
  const chatId = message.chat.id
  const userId = message.from.id
  
  try {
    // Получаем пользователя из БД
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single()
    
    if (!user) {
      await sendMessage(chatId, "❌ Пользователь не найден. Используй /start")
      return
    }
    
    // Проверяем подписку
    const hasAccess = await checkSubscriptionAccess(user.id)
    if (!hasAccess) {
      await sendMessage(
        chatId,
        "⚠️ **Распознавание по фото доступно только с подпиской**\n\n" +
        "Оформи подписку, чтобы использовать эту функцию!",
        {
          inline_keyboard: [
            [{ text: "💎 Оформить подписку", callback_data: "buy_subscription" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
      return
    }
    
    await sendMessage(chatId, "📸 Анализирую фото...\n\n⚠️ **Внимание:** Это примерная оценка на основе визуального анализа. Точность может быть невысокой!")
    
    // Получаем самое большое фото (последнее в массиве)
    const photo = message.photo![message.photo!.length - 1]
    const photoUrl = await getPhotoUrl(photo.file_id)
    
    if (!photoUrl) {
      await sendMessage(chatId, "❌ Не удалось получить фото. Попробуй еще раз.")
      return
    }
    
    // Анализируем фото
    const analysis = await analyzeFoodPhoto(photoUrl, message.caption)
    
    // Формируем текст с результатами
    let resultText = `📊 **Результаты анализа фото:**\n\n`
    
    // Добавляем дисклеймер о точности
    const confidenceEmoji = {
      'low': '🟡',
      'medium': '🟠',
      'high': '🟢'
    }
    resultText += `${confidenceEmoji[analysis.confidence] || '🟡'} Уверенность: ${analysis.confidence === 'low' ? 'низкая' : analysis.confidence === 'medium' ? 'средняя' : 'высокая'}\n\n`
    
    // Список продуктов
    resultText += `🍽️ **Обнаружено:**\n`
    for (const item of analysis.items) {
      resultText += `• ${item.name} (~${item.weight}г)\n`
      resultText += `  К: ${item.calories} | Б: ${item.protein}г | Ж: ${item.fats}г | У: ${item.carbs}г\n`
    }
    
    resultText += `\n📈 **Итого:**\n`
    resultText += `🔥 Калории: ${analysis.total.calories} ккал\n`
    resultText += `🥩 Белки: ${analysis.total.protein}г\n`
    resultText += `🧈 Жиры: ${analysis.total.fats}г\n`
    resultText += `🍞 Углеводы: ${analysis.total.carbs}г\n`
    
    if (analysis.notes) {
      resultText += `\n💡 ${analysis.notes}\n`
    }
    
    resultText += `\n⚠️ **Это примерная оценка!** Для точности рекомендуем взвешивать продукты.`
    
    await sendMessage(chatId, resultText, {
      inline_keyboard: [
        [{ text: "✅ Записать", callback_data: `confirm_photo_${user.id}` }],
        [{ text: "✏️ Изменить", callback_data: "edit_photo_meal" }],
        [{ text: "❌ Отмена", callback_data: "main_menu" }]
      ]
    })
    
    // Сохраняем данные анализа в состоянии для подтверждения
    await setUserState(userId, 'photo_analysis_pending', {
      analysis: analysis,
      photo_url: photoUrl
    })
    
  } catch (error) {
    console.error('Error handling photo message:', error)
    await sendMessage(chatId, "❌ Ошибка анализа фото. Попробуй еще раз или опиши еду текстом.")
  }
}
/**
 * Показать меню уведомлений
 */
async function showNotificationsMenu(chatId: number, dbUserId: number) {
  try {
    // Получаем или создаем настройки уведомлений
    let { data: settings } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', dbUserId)
      .single()
    
    // Если настроек нет, создаем с дефолтными значениями
    if (!settings) {
      const { data: newSettings } = await supabase
        .from('notification_settings')
        .insert({
          user_id: dbUserId,
          food_notifications_enabled: true,
          water_notifications_enabled: true
        })
        .select()
        .single()
      
      settings = newSettings
    }
    
    const foodStatus = settings.food_notifications_enabled ? '✅ Вкл' : '❌ Выкл'
    const waterStatus = settings.water_notifications_enabled ? '✅ Вкл' : '❌ Выкл'
    
    const menuText = `🔔 **Настройки уведомлений**
📊 **Уведомления о еде:** ${foodStatus}
Напоминания о приемах пищи с ${settings.food_notification_start_time.substring(0, 5)} до ${settings.food_notification_end_time.substring(0, 5)}
Количество напоминаний: ${settings.food_notification_count} раз в день
💧 **Уведомления о воде:** ${waterStatus}
Напоминания пить воду с ${settings.water_notification_start_time.substring(0, 5)} до ${settings.water_notification_end_time.substring(0, 5)}
Интервал: каждые ${settings.water_notification_interval_minutes} минут
💡 Уведомления помогут тебе не забывать о питании и поддерживать водный баланс!`
    
    await sendMessage(chatId, menuText, {
      inline_keyboard: [
        [{ 
          text: settings.food_notifications_enabled ? "🍽 Еда: Выключить" : "🍽 Еда: Включить", 
          callback_data: "toggle_food_notifications" 
        }],
        [{ 
          text: settings.water_notifications_enabled ? "💧 Вода: Выключить" : "💧 Вода: Включить", 
          callback_data: "toggle_water_notifications" 
        }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
  } catch (error) {
    console.error('Error showing notifications menu:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки настроек уведомлений")
  }
}
/**
 * Переключить уведомления
 */
async function toggleNotifications(chatId: number, dbUserId: number, type: 'food' | 'water') {
  try {
    // Получаем текущие настройки
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', dbUserId)
      .single()
    
    if (!settings) {
      await sendMessage(chatId, "❌ Настройки не найдены")
      return
    }
    
    // Переключаем нужное поле
    const field = type === 'food' ? 'food_notifications_enabled' : 'water_notifications_enabled'
    const newValue = !settings[field]
    
    await supabase
      .from('notification_settings')
      .update({ [field]: newValue })
      .eq('user_id', dbUserId)
    
    const emoji = type === 'food' ? '🍽' : '💧'
    const name = type === 'food' ? 'уведомления о еде' : 'уведомления о воде'
    const status = newValue ? 'включены' : 'выключены'
    
    await sendMessage(chatId, `${emoji} ${name.charAt(0).toUpperCase() + name.slice(1)} ${status}!`)
    
    // Показываем обновленное меню
    await showNotificationsMenu(chatId, dbUserId)
  } catch (error) {
    console.error('Error toggling notifications:', error)
    await sendMessage(chatId, "❌ Ошибка изменения настроек")
  }
}
/**
 * Показать меню помощи
 */
async function showHelpMenu(chatId: number, dbUserId: number) {
  // Получаем информацию о подписке
  const subscriptionData = await getSubscriptionInfo(dbUserId)
  const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
  
  let subscriptionText = ''
  if (subscriptionInfo) {
    if (subscriptionInfo.is_unlimited) {
      subscriptionText = `\n📦 **Подписка:** ✨ Безлимитная (подарок от админа)\n\n`
    } else if (subscriptionInfo.is_trial && !subscriptionInfo.needs_payment) {
      const expiresDate = new Date(subscriptionInfo.expires_at)
      const daysLeft = Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      subscriptionText = `\n📦 **Подписка:** 🎁 Пробный период (${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'} осталось)\n\n`
    } else if (!subscriptionInfo.needs_payment) {
      const expiresDate = new Date(subscriptionInfo.expires_at)
      const formattedDate = expiresDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      subscriptionText = `\n📦 **Подписка:** ✅ Активна до ${formattedDate}\n\n`
    }
  }
  
  const helpText = `❓ **Помощь и поддержка**
${subscriptionText}
🤖 **Что умеет C.I.D.:**

📊 **Персональный план КБЖУ**
Рассчитываю рацион по научной методике Миффлина-Сан Жеора на основе твоих данных (возраст, вес, рост, активность, цели)

🍽️ **Умная запись еды**
Записывай приемы пищи текстом, голосом или 📸 фотографией. AI анализирует блюда и показывает детальную разбивку по продуктам

💬 **AI-диетолог (просто задавай вопросы!)**
Отвечаю на вопросы о питании, предлагаю рецепты с учетом остатка КБЖУ, помогаю планировать меню. Просто напиши в чат любой вопрос - я автоматически пойму и отвечу!

📋 **Дневник питания**
Веду историю приемов пищи с визуализацией прогресса по КБЖУ и воде, возможностью редактирования записей

💧 **Трекинг воды**
Записывай выпитую воду и следи за прогрессом в дневнике. Можно включить напоминания!

🔥 **Система Streak**
Логируй еду каждый день и наращивай серию! Это мотивирует и помогает выработать привычку следить за питанием

📖 **Шаблоны и рецепты**
Сохраняй часто повторяющиеся приемы пищи как шаблоны для быстрого логирования. Сохраняй любимые рецепты с инструкциями

🎤 **Голосовой ввод**
Поддерживаю голосовые сообщения - наговаривай вместо печати

📸 **Распознавание по фото**
Сфотографируй еду - я автоматически распознаю продукты и рассчитаю КБЖУ
---
💎 **Поддержать проект:**
Спасибо всем, кто поддерживает развитие бота! Ваша поддержка помогает делать C.I.D. лучше каждый день.
---
📞 **Связь с администратором:**
По всем вопросам, предложениям и проблемам пишите:
👤 @gena12m
Буду рад вашей обратной связи! 🙏`
  await sendMessage(chatId, helpText, {
    inline_keyboard: [
      [{ text: "💝 Поддержать проект", callback_data: "support_project" }],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  })
}
/**
 * Показать меню профиля пользователя
 */
async function showProfileMenu(chatId: number, dbUserId: number) {
  try {
    // ⚡ PHASE 2 OPTIMIZATION: 1 запрос вместо 2
    const context = await getUserFullContextById(dbUserId)
    const profile = context?.profile
    const plan = context?.plan

    if (!profile) {
      await sendMessage(chatId, "❌ Профиль не найден. Заполни профиль через /start")
      return
    }
    
    const genderEmoji = profile.gender === 'male' ? '👨' : '👩'
    const activityLevel = profile.activity_level === 'sedentary' ? 'Низкая' :
                         profile.activity_level === 'lightly_active' ? 'Легкая' :
                         profile.activity_level === 'moderately_active' ? 'Средняя' :
                         profile.activity_level === 'very_active' ? 'Высокая' : 'Очень высокая'
    
    let profileText = `👤 **Твой профиль**\n\n`
    profileText += `${genderEmoji} **Пол:** ${profile.gender === 'male' ? 'Мужской' : 'Женский'}\n`
    profileText += `📏 **Рост:** ${profile.height} см\n`
    profileText += `⚖️ **Вес:** ${profile.current_weight} кг\n`
    profileText += `🎂 **Возраст:** ${profile.age} лет\n`
    profileText += `🏃 **Активность:** ${activityLevel}\n\n`
    
    if (plan) {
      profileText += `📊 **Твой план КБЖУ:**\n`
      profileText += `🔥 Калории: ${Math.round(plan.calories)} ккал\n`
      profileText += `🍗 Белки: ${Math.round(plan.protein)} г\n`
      profileText += `🥑 Жиры: ${Math.round(plan.fats)} г\n`
      profileText += `🍞 Углеводы: ${Math.round(plan.carbs)} г\n`
      profileText += `💧 Вода: ${Math.round(plan.water * 10) / 10} л\n\n`
    }

    // 🔥 STREAK SYSTEM: Получаем статистику streak
    try {
      const { data: streakStats, error: streakError } = await supabase
        .rpc('get_user_streak_stats', { p_user_id: dbUserId })
        .single()

      console.log('Streak stats:', { streakStats, streakError })

      if (!streakError && streakStats) {
        profileText += `🔥 **Твой Streak:**\n`
        profileText += `• Текущий: **${streakStats.current_streak}** ${streakStats.current_streak === 1 ? 'день' : streakStats.current_streak < 5 ? 'дня' : 'дней'}\n`
        profileText += `• Рекорд: **${streakStats.longest_streak}** ${streakStats.longest_streak === 1 ? 'день' : streakStats.longest_streak < 5 ? 'дня' : 'дней'}\n`
        profileText += `• Всего логов: **${streakStats.total_logs}**\n`

        if (streakStats.is_at_risk && streakStats.current_streak > 0) {
          profileText += `\n⚠️ Streak в опасности! Не забудь залогировать еду сегодня!\n`
        }

        // Показываем достижения если есть
        if (streakStats.achievements && streakStats.achievements.length > 0) {
          const achievementsCount = streakStats.achievements.length
          profileText += `\n🏆 **Достижения (${achievementsCount}):**\n`

          // Показываем последние 5 достижений
          const recentAchievements = streakStats.achievements.slice(0, 5)
          for (const achievement of recentAchievements) {
            const icon = achievement.type === 'streak_3' ? '🔥' :
                        achievement.type === 'streak_7' ? '⭐' :
                        achievement.type === 'streak_14' ? '💫' :
                        achievement.type === 'streak_30' ? '🌟' :
                        achievement.type === 'streak_100' ? '👑' :
                        achievement.type === 'total_logs_10' ? '📊' :
                        achievement.type === 'total_logs_50' ? '📈' :
                        achievement.type === 'total_logs_100' ? '🎯' : '🏆'

            profileText += `${icon} **${achievement.name}** — ${achievement.description}\n`
          }

          if (achievementsCount > 5) {
            profileText += `_...и еще ${achievementsCount - 5}_\n`
          }
        }

        profileText += `\n`
      } else if (streakError) {
        console.error('Streak error details:', streakError)
        // Показываем хотя бы базовую информацию
        profileText += `🔥 **Твой Streak:**\n`
        profileText += `• Начни логировать еду, чтобы набрать серию!\n\n`
      }
    } catch (error) {
      console.error('Error getting streak stats:', error)
    }

    // Получаем информацию о подписке
    const subscriptionData = await getSubscriptionInfo(dbUserId)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    console.log('Subscription info:', JSON.stringify(subscriptionInfo))
    
    if (subscriptionInfo) {
      profileText += `📦 **Подписка:**\n`
      
      if (subscriptionInfo.is_unlimited) {
        profileText += `✨ **Безлимитная** (подарок от админа)\n\n`
      } else if (subscriptionInfo.is_trial && !subscriptionInfo.needs_payment) {
        const daysLeft = Math.ceil((new Date(subscriptionInfo.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        profileText += `🎁 **Пробный период:** ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'} осталось\n`
        profileText += `\n💡 Сейчас ничего вводить не нужно. После истечения пробного периода появится кнопка оплаты.\n\n`
      } else if (subscriptionInfo.needs_payment) {
        profileText += `🔒 **Истекла**\n\n`
        profileText += `💳 Оформи подписку для продолжения:\n`
        profileText += `📦 1 месяц - 129₽\n`
        profileText += `📦 6 месяцев - 649₽\n`
        profileText += `📦 1 год - 1099₽\n\n`
      } else {
        const daysLeft = Math.ceil((new Date(subscriptionInfo.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        profileText += `✅ **Активна:** ${subscriptionInfo.plan_name}\n`
        profileText += `⏰ **Осталось:** ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}\n\n`
      }
    }
    
    profileText += `💡 Здесь ты можешь отредактировать свои параметры или изменить план КБЖУ`
    
    const keyboard: any[] = [
      [
        { text: "📈 График прогресса", callback_data: "show_charts" },
        { text: "⚖️ Записать вес", callback_data: "log_weight" }
      ],
      [{ text: "📊 Изменить план КБЖУ", callback_data: "edit_nutrition" }],
      [{ text: "✏️ Изменить параметры", callback_data: "edit_parameters" }]
    ]

    // Показываем кнопку покупки только если подписка истекла
    if (subscriptionInfo && subscriptionInfo.needs_payment) {
      keyboard.unshift([{ text: "💳 Купить подписку", callback_data: "buy_subscription" }])
    }

    keyboard.push([{ text: "🏠 Главное меню", callback_data: "main_menu" }])
    
    await sendMessage(chatId, profileText, {
      inline_keyboard: keyboard
    })
  } catch (error) {
    console.error('Error showing profile menu:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки профиля")
  }
}
/**
 * Показать меню предпочтений пользователя
 */
async function showUserPreferencesMenu(chatId: number, dbUserId: number) {
  try {
    const preferences = await getUserPreferences(dbUserId)
    
    let text = `🎯 **Мои предпочтения**\n\n`
    
    if (preferences.length === 0) {
      text += `У тебя пока нет сохраненных предпочтений.\n\n`
      text += `💡 Просто упомяни их в диалоге с C.I.D.! Например:\n`
      text += `• "У меня непереносимость лактозы"\n`
      text += `• "Я не ем рыбу"\n`
      text += `• "Без глютена"\n\n`
      text += `Я автоматически запомню и всегда буду учитывать это при составлении планов питания.`
    } else {
      // Группируем предпочтения по типам
      const allergies = preferences.filter(p => p.preference_type === 'allergy')
      const intolerances = preferences.filter(p => p.preference_type === 'intolerance')
      const excludes = preferences.filter(p => p.preference_type === 'exclude')
      const dislikes = preferences.filter(p => p.preference_type === 'dislike')
      
      if (allergies.length > 0) {
        text += `🚫 **Аллергии:**\n`
        allergies.forEach(p => {
          text += `• ${p.item}\n`
        })
        text += `\n`
      }
      
      if (intolerances.length > 0) {
        text += `⚠️ **Непереносимость:**\n`
        intolerances.forEach(p => {
          text += `• ${p.item}\n`
        })
        text += `\n`
      }
      
      if (excludes.length > 0) {
        text += `❌ **Исключено из рациона:**\n`
        excludes.forEach(p => {
          text += `• ${p.item}\n`
        })
        text += `\n`
      }
      
      if (dislikes.length > 0) {
        text += `👎 **Не нравится:**\n`
        dislikes.forEach(p => {
          text += `• ${p.item}\n`
        })
        text += `\n`
      }
      
      text += `\n💡 Эти предпочтения учитываются при составлении планов питания и рецептов.`
    }
    
    const keyboard: any[] = []
    
    if (preferences.length > 0) {
      keyboard.push([{ text: "🗑 Очистить все предпочтения", callback_data: "clear_all_preferences" }])
    }
    
    keyboard.push(
      [{ text: "🔄 Очистить историю диалога", callback_data: "clear_chat_history" }],
      [{ text: "🔙 Назад", callback_data: "cancel_action" }]
    )
    
    await sendMessage(chatId, text, {
      inline_keyboard: keyboard
    })
  } catch (error) {
    console.error('Error showing preferences menu:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки предпочтений")
  }
}
/**
 * Показать меню подписки
 */
async function showSubscriptionMenu(chatId: number, dbUserId: number) {
  try {
    // Получаем информацию о подписке
    const subscriptionData = await getSubscriptionInfo(dbUserId)
    const subscriptionInfo = Array.isArray(subscriptionData) ? subscriptionData[0] : subscriptionData
    
    let statusText = ''
    let statusEmoji = ''
    let keyboard: any[] = []
    
    if (!subscriptionInfo) {
      statusText = `❌ **Подписка не активна**\n\nДля использования бота необходима активная подписка.`
      statusEmoji = '❌'
      keyboard = [
        [{ text: "💳 Купить подписку", callback_data: "buy_subscription" }],
        [{ text: "🔙 Назад", callback_data: "cancel_action" }]
      ]
    } else if (subscriptionInfo.is_unlimited) {
      // Безлимитная подписка от админа
      statusText = `✨ **Безлимитная подписка**\n\n🎁 У тебя безлимитный доступ ко всем функциям бота (подарок от администратора)\n\nВсё работает без ограничений!`
      statusEmoji = '✨'
      keyboard = [
        [{ text: "🔙 Назад", callback_data: "cancel_action" }]
      ]
    } else if (subscriptionInfo.is_trial && !subscriptionInfo.needs_payment) {
      // Trial период
      const expiresDate = new Date(subscriptionInfo.expires_at)
      const daysLeft = Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      const formattedDate = expiresDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      
      statusText = `🎁 **Пробный период**\n\n` +
        `⏰ **Осталось:** ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}\n` +
        `📅 **Активен до:** ${formattedDate}\n\n` +
        `💡 Сейчас ты пользуешься всеми функциями бесплатно!\n\n` +
        `После окончания пробного периода можешь продлить подписку:\n` +
        `• 1 месяц — 129₽\n` +
        `• 6 месяцев — 649₽ (выгодно!)\n` +
        `• 1 год — 1099₽ (супер выгодно!)`
      statusEmoji = '🎁'
      keyboard = [
        [{ text: "💳 Купить подписку заранее", callback_data: "buy_subscription" }],
        [{ text: "🔙 Назад", callback_data: "cancel_action" }]
      ]
    } else if (subscriptionInfo.needs_payment) {
      // Подписка истекла
      statusText = `⏰ **Подписка истекла**\n\n` +
        `😔 Твоя подписка закончилась.\n\n` +
        `Продли подписку, чтобы продолжить пользоваться всеми функциями бота:\n` +
        `• 1 месяц — 129₽\n` +
        `• 6 месяцев — 649₽ (выгодно!)\n` +
        `• 1 год — 1099₽ (супер выгодно!)`
      statusEmoji = '⏰'
      keyboard = [
        [{ text: "💳 Продлить подписку", callback_data: "buy_subscription" }],
        [{ text: "🔙 Назад", callback_data: "cancel_action" }]
      ]
    } else {
      // Активная платная подписка
      const expiresDate = new Date(subscriptionInfo.expires_at)
      const daysLeft = Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      const formattedDate = expiresDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      
      // Определяем название плана
      let planName = 'Активная'
      if (subscriptionInfo.plan_name === 'monthly') planName = 'Месячная'
      else if (subscriptionInfo.plan_name === 'quarterly') planName = 'Квартальная (3 месяца)'
      else if (subscriptionInfo.plan_name === 'yearly') planName = 'Годовая'
      
      statusText = `✅ **Подписка активна**\n\n` +
        `📦 **План:** ${planName}\n` +
        `📅 **Активна до:** ${formattedDate}\n` +
        `⏰ **Осталось:** ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}\n\n` +
        `✨ Все функции бота доступны!`
      statusEmoji = '✅'
      keyboard = [
        [{ text: "🔄 Сменить план", callback_data: "buy_subscription" }],
        [{ text: "💝 Поддержать проект", callback_data: "support_project" }],
        [{ text: "🔙 Назад", callback_data: "cancel_action" }]
      ]
    }
    
    const messageText = `💎 **Управление подпиской**\n\n${statusText}`
    
    await sendMessage(chatId, messageText, {
      inline_keyboard: keyboard
    })
  } catch (error) {
    console.error('Error showing subscription menu:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки информации о подписке")
  }
}
/**
 * Управление приемами пищи (за последние 2 дня)
 */
async function manageMeals(chatId: number, dbUserId: number) {
  try {
    // Вычисляем дату 2 дня назад
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const startDate = twoDaysAgo.toISOString().split('T')[0]
    
    // Получаем записи за последние 2 дня
    const { data: logs } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', dbUserId)
      .gte('logged_at', `${startDate}T00:00:00`)
      .order('logged_at', { ascending: false })
    
    if (!logs || logs.length === 0) {
      await sendMessage(chatId, "📝 **Нет записей за последние 2 дня**\n\nДобавь первый прием пищи!", {
        inline_keyboard: [
          [{ text: "🍽 Записать прием", callback_data: "quick_log_food" }],
          [{ text: "🔙 Назад", callback_data: "cancel_action" }]
        ]
      })
      return
    }
    
    // Группируем записи по дням
    const logsByDate: { [key: string]: any[] } = {}
    logs.forEach(log => {
      const date = new Date(log.logged_at).toISOString().split('T')[0]
      if (!logsByDate[date]) {
        logsByDate[date] = []
      }
      logsByDate[date].push(log)
    })
    
    let message = `📝 **Приемы пищи за последние 2 дня**\n\n`
    const keyboard: any = { inline_keyboard: [] }
    
    // Форматируем дату
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr)
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      
      if (dateStr === today) return '📅 **Сегодня**'
      if (dateStr === yesterdayStr) return '📅 **Вчера**'
      return `📅 **${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}**`
    }
    
    // Отображаем записи по дням
    let mealIndex = 0
    Object.keys(logsByDate).sort().reverse().forEach(date => {
      message += `${formatDate(date)}\n\n`

      logsByDate[date].forEach(log => {
        mealIndex++

        // Определяем период дня вместо точного времени
        const logDate = new Date(log.logged_at)
        const hour = logDate.getHours()
        let period = ''
        if (hour >= 5 && hour < 12) period = '☀️ Утро'
        else if (hour >= 12 && hour < 17) period = '🌞 День'
        else if (hour >= 17 && hour < 22) period = '🌆 Вечер'
        else period = '🌙 Ночь'

        // Показываем полное описание (до 100 символов)
        const desc = log.description.length > 100
          ? log.description.substring(0, 100) + '...'
          : log.description

        message += `**${mealIndex}.** ${period}\n`
        message += `${desc}\n`
        message += `🔥 ${log.calories} ккал • Б: ${log.protein}г • Ж: ${log.fats}г • У: ${log.carbs}г\n`
        message += `━━━━━━━━━━━━━━\n`

        // Inline кнопки для каждого приема
        keyboard.inline_keyboard.push([
          { text: `✏️ #${mealIndex}`, callback_data: `edit_meal_${log.id}` },
          { text: `🗑 #${mealIndex}`, callback_data: `delete_meal_${log.id}` }
        ])

        message += '\n'
      })
    })
    
    // Навигационные кнопки
    keyboard.inline_keyboard.push(
      [{ text: "🍽 Добавить прием", callback_data: "quick_log_food" }],
      [{ text: "📊 Статистика", callback_data: "diary" }],
      [{ text: "🔙 Назад", callback_data: "cancel_action" }]
    )
    
    await sendMessage(chatId, message, keyboard)
  } catch (error) {
    console.error('Error managing meals:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки приемов пищи")
  }
}
/**
 * Показать подтверждение удаления приема пищи
 */
async function deleteMeal(chatId: number, dbUserId: number, mealId: number) {
  try {
    // Получаем информацию о приеме
    const { data: meal } = await supabase
      .from('food_logs')
      .select('*')
      .eq('id', mealId)
      .eq('user_id', dbUserId)
      .single()
    
    if (!meal) {
      await sendMessage(chatId, "❌ Прием пищи не найден")
      return
    }
    
    const time = new Date(meal.logged_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    
    // Показываем подтверждение с деталями
    await sendMessage(
      chatId,
      `⚠️ **Подтвердите удаление**\n\n` +
      `⏰ ${time}\n` +
      `📝 ${meal.description}\n` +
      `🔥 ${meal.calories} ккал | 🥩 Б:${meal.protein}г | 🥑 Ж:${meal.fats}г | 🍞 У:${meal.carbs}г\n\n` +
      `Это действие нельзя отменить.`,
      {
        inline_keyboard: [
          [
            { text: "✅ Да, удалить", callback_data: `confirm_delete_meal_${mealId}` },
            { text: "❌ Отмена", callback_data: "manage_meals" }
          ]
        ]
      }
    )
  } catch (error) {
    console.error('Error showing delete confirmation:', error)
    await sendMessage(chatId, "❌ Ошибка")
  }
}
/**
 * Подтвердить удаление приема пищи
 */
async function confirmDeleteMeal(chatId: number, dbUserId: number, mealId: number) {
  try {
    // Получаем информацию о приеме
    const { data: meal } = await supabase
      .from('food_logs')
      .select('*')
      .eq('id', mealId)
      .eq('user_id', dbUserId)
      .single()
    
    if (!meal) {
      await sendMessage(chatId, "❌ Прием пищи не найден")
      return
    }
    
    // Удаляем
    const { error } = await supabase
      .from('food_logs')
      .delete()
      .eq('id', mealId)
      .eq('user_id', dbUserId)
    
    if (error) {
      throw error
    }
    
    const time = new Date(meal.logged_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    await sendMessage(
      chatId,
      `✅ **Прием пищи удален**\n\n⏰ ${time}\n📝 ${meal.description}`,
      {
        inline_keyboard: [
          [{ text: "📝 Мои приемы", callback_data: "manage_meals" }],
          [{ text: "🔙 Назад", callback_data: "cancel_action" }]
        ]
      }
    )
  } catch (error) {
    console.error('Error deleting meal:', error)
    await sendMessage(chatId, "❌ Ошибка удаления приема пищи")
  }
}
/**
 * Показать дневник
 */
async function showDiary(chatId: number, dbUserId: number) {
  try {
    // Получаем план
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', dbUserId)
      .eq('is_active', true)
      .single()
    
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', dbUserId)
      .single()
    
    // Получаем записи за сегодня
    const today = new Date().toISOString().split('T')[0]
    const { data: todayLogs } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', dbUserId)
      .gte('logged_at', `${today}T00:00:00`)
      .order('logged_at', { ascending: false })
    
    // Считаем съеденное
    const consumed = todayLogs?.reduce((acc, log) => ({
      calories: acc.calories + (log.calories || 0),
      protein: acc.protein + (log.protein || 0),
      fats: acc.fats + (log.fats || 0),
      carbs: acc.carbs + (log.carbs || 0)
    }), { calories: 0, protein: 0, fats: 0, carbs: 0 }) || { calories: 0, protein: 0, fats: 0, carbs: 0 }
    
    // Округление до 1 знака после запятой
    const round = (num: number) => Math.round(num * 10) / 10

    let diaryText = `📊 **Дневник за ${new Date().toLocaleDateString('ru-RU')}**
**План на день:**
🔥 Калории: ${Math.round(plan.calories)} ккал
🥩 Белки: ${Math.round(plan.protein)}г
🥑 Жиры: ${Math.round(plan.fats)}г
🍞 Углеводы: ${Math.round(plan.carbs)}г
💧 Вода: ${round(plan.water)}л
**Съедено:**
🔥 ${round(consumed.calories)} / ${Math.round(plan.calories)} ккал (${Math.round(consumed.calories / plan.calories * 100)}%)
🥩 ${round(consumed.protein)}г / ${Math.round(plan.protein)}г
🥑 ${round(consumed.fats)}г / ${Math.round(plan.fats)}г
🍞 ${round(consumed.carbs)}г / ${Math.round(plan.carbs)}г
**Осталось:**
🔥 ${round(plan.calories - consumed.calories)} ккал
🥩 ${round(plan.protein - consumed.protein)}г белка
🥑 ${round(plan.fats - consumed.fats)}г жиров
🍞 ${round(plan.carbs - consumed.carbs)}г углеводов`
    // Добавляем список приемов пищи
    if (todayLogs && todayLogs.length > 0) {
      diaryText += '\n\n**📝 Приемы пищи:**'
      todayLogs.forEach((log, index) => {
        const time = new Date(log.logged_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        const shortDesc = log.description.length > 50 ? log.description.substring(0, 50) + '...' : log.description
        diaryText += `\n${index + 1}. ${time} - ${shortDesc}`
        diaryText += `\n   🔥 ${log.calories}ккал | Б:${log.protein}г | Ж:${log.fats}г | У:${log.carbs}г`
      })
    }
    
    // 🔥 ОПТИМИЗИРОВАННАЯ клавиатура с быстрыми действиями
    await sendMessage(chatId, diaryText, myDayActionsKeyboard())
  } catch (error) {
    console.error('Error showing diary:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки дневника")
  }
}
/**
 * Онбординг для новых пользователей
 */
async function startOnboarding(chatId: number, userId: number) {
  try {
    // Шаг 1: Приветствие и обзор
    await sendMessage(
      chatId,
      `🎉 **Добро пожаловать в C.I.D.!**\n\n` +
      `Я твой персональный AI-диетолог. Давай разберемся, как я работаю!\n\n` +
      `📱 **Что я умею:**\n` +
      `• Записывать приемы пищи (текст, голос, 📸 фото)\n` +
      `• Анализировать КБЖУ и следить за прогрессом\n` +
      `• Отвечать на вопросы о питании\n` +
      `• Предлагать рецепты и составлять меню\n` +
      `• Трекать воду и напоминать о приемах пищи\n` +
      `• Мотивировать через систему Streak 🔥\n\n` +
      `🚀 **Начнем с основ!**`,
      {
        inline_keyboard: [
          [{ text: "➡️ Далее", callback_data: "onboarding_step_2" }],
          [{ text: "⏭️ Пропустить", callback_data: "main_menu" }]
        ]
      }
    )
  } catch (error) {
    console.error('Error in onboarding:', error)
    await sendMessage(chatId, "❌ Ошибка. Переходим в главное меню.", getMainKeyboard())
  }
}
/**
 * Шаг 2 онбординга: Главное меню
 */
async function onboardingStep2(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `🏠 **Главное меню**\n\n` +
    `Это твоя база! Отсюда ты можешь:\n\n` +
    `📊 **Дневник** - смотреть статистику КБЖУ, воды и все приемы пищи\n` +
    `📖 **Рецепты** - сохраненные рецепты и шаблоны блюд\n` +
    `👤 **Профиль** - твой план КБЖУ, Streak 🔥 и прогресс\n\n` +
    `💡 **Совет:** Чтобы записать еду, просто напиши в чат что съел!`,
    {
      inline_keyboard: [
        [{ text: "➡️ Далее", callback_data: "onboarding_step_3" }],
        [{ text: "⏭️ Пропустить", callback_data: "main_menu" }]
      ]
    }
  )
}
/**
 * Шаг 3 онбординга: Запись еды
 */
async function onboardingStep3(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `🍽️ **Как записать прием пищи**\n\n` +
    `**Способ 1:** Просто напиши в чат\n` +
    `• "банан 150г, овсянка 60г"\n` +
    `• "съел курицу с рисом"\n` +
    `• "выпил кофе с молоком"\n\n` +
    `**Способ 2:** 🎤 Голосовое сообщение\n` +
    `• Нажми микрофон и расскажи что съел\n` +
    `• Я распознаю речь и запишу!\n\n` +
    `**Способ 3:** 📸 Фотография еды\n` +
    `• Сфотографируй свою еду\n` +
    `• AI автоматически распознает продукты и рассчитает КБЖУ!\n\n` +
    `🤖 **После записи я:**\n` +
    `• Подсчитаю калории и КБЖУ\n` +
    `• Покажу детализацию по каждому продукту\n` +
    `• Дам персональный совет по питанию`,
    {
      inline_keyboard: [
        [{ text: "➡️ Далее", callback_data: "onboarding_step_4" }],
        [{ text: "⏭️ Пропустить", callback_data: "main_menu" }]
      ]
    }
  )
}
/**
 * Шаг 4 онбординга: Редактирование
 */
async function onboardingStep4(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `✏️ **Редактирование и шаблоны**\n\n` +
    `После записи еды ты увидишь кнопки:\n\n` +
    `✏️ **Изменить** - исправить описание или вес\n` +
    `🗑️ **Удалить** - убрать запись\n` +
    `💾 **Сохранить как шаблон** - для быстрого повтора\n` +
    `📊 **Статистика** - посмотреть дневник\n\n` +
    `📖 **Шаблоны и рецепты:**\n` +
    `• Сохраняй часто повторяющиеся приемы\n` +
    `• Используй готовые шаблоны одним нажатием\n` +
    `• Храни любимые рецепты с инструкциями`,
    {
      inline_keyboard: [
        [{ text: "➡️ Далее", callback_data: "onboarding_step_5" }],
        [{ text: "⏭️ Пропустить", callback_data: "main_menu" }]
      ]
    }
  )
}
/**
 * Шаг 5 онбординга: Настройки
 */
async function onboardingStep5(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `📊 **Дневник и профиль**\n\n` +
    `**📊 В дневнике увидишь:**\n` +
    `• Статистику КБЖУ за день (прогресс-бар)\n` +
    `• Трекинг воды 💧\n` +
    `• Все приемы пищи с деталями\n\n` +
    `**👤 В профиле увидишь:**\n` +
    `• Свой персональный план КБЖУ\n` +
    `• Систему Streak 🔥 (серия дней логирования)\n` +
    `• Общую статистику и прогресс\n\n` +
    `**🔥 Streak мотивация:**\n` +
    `Логируй еду каждый день и наращивай свой Streak!\nЭто поможет выработать привычку следить за питанием.`,
    {
      inline_keyboard: [
        [{ text: "➡️ Далее", callback_data: "onboarding_step_6" }],
        [{ text: "⏭️ Пропустить", callback_data: "main_menu" }]
      ]
    }
  )
}
/**
 * Шаг 6 онбординга: Советы и завершение
 */
async function onboardingStep6(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `💡 **AI-консультации и советы**\n\n` +
    `🤖 **Просто задавай вопросы в чат:**\n` +
    `• "Можно ли мне банан?"\n` +
    `• "Что приготовить из курицы?"\n` +
    `• "Предложи рецепт на ужин"\n` +
    `• "Как добить белки?"\n\n` +
    `Я автоматически пойму, что это вопрос, и дам персональный совет с учетом твоего остатка КБЖУ!\n\n` +
    `**Полезные советы:**\n` +
    `• Записывай еду сразу после приема\n` +
    `• Указывай вес продуктов (150г, 200мл)\n` +
    `• 📸 Фотографируй еду для автоматического распознавания\n` +
    `• Трекай воду 💧 - это важно!\n` +
    `• Поддерживай Streak 🔥 для формирования привычки\n\n` +
    `🚀 **Готов начать?**`,
    {
      inline_keyboard: [
        [{ text: "🎯 Начать пользоваться!", callback_data: "main_menu" }]
      ]
    }
  )
}
/**
 * Показать опции доната
 */
async function showDonationOptions(chatId: number, userId: number) {
  await sendMessage(
    chatId,
    `💝 **Поддержать проект C.I.D.**\n\n` +
    `Спасибо, что хочешь поддержать развитие бота!\n\n` +
    `Твой донат поможет:\n` +
    `• Оплачивать серверы и AI\n` +
    `• Добавлять новые функции\n` +
    `• Улучшать качество сервиса\n\n` +
    `💰 **Выбери сумму или укажи свою:**`,
    {
      inline_keyboard: [
        [
          { text: "☕ 100₽", callback_data: "donate_100" },
          { text: "🍕 300₽", callback_data: "donate_300" }
        ],
        [
          { text: "🎁 500₽", callback_data: "donate_500" },
          { text: "💎 1000₽", callback_data: "donate_1000" }
        ],
        [
          { text: "✏️ Своя сумма", callback_data: "donate_custom" }
        ],
        [
          { text: "❌ Отмена", callback_data: "main_menu" }
        ]
      ]
    }
  )
}
/**
 * Создать платеж для доната
 */
async function createDonationPayment(chatId: number, dbUserId: number, amount: number) {
  try {
    console.log('createDonationPayment called with:', { chatId, dbUserId, amount, dbUserIdType: typeof dbUserId })
    
    await sendMessage(chatId, "⏳ Создаю счет на оплату...")
    
    // Генерируем уникальный order_id
    const orderId = `donation_${dbUserId}_${Date.now()}`
    
    // Создаем платежное намерение в базе данных
    const { data: paymentIntent, error } = await supabase
      .from('payment_intents')
      .insert({
        user_id: dbUserId,
        plan_id: null, // Для доната plan_id не нужен
        order_id: orderId,
        amount_rub: amount,
        amount_kopeks: amount * 100,
        description: `Поддержка проекта C.I.D. - ${amount}₽`,
        status: 'NEW',
        is_donation: true // Флаг доната
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating donation payment intent:', error)
      await sendMessage(chatId, "❌ Ошибка создания платежа. Попробуй позже.")
      return
    }
    
    // Вызываем функцию создания платежа через T-Bank
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const requestData = {
      userId: Number(dbUserId),  // Убеждаемся что это число
      amount_rub: amount,
      order_id: orderId,
      description: `Поддержка проекта C.I.D. - ${amount}₽`,
      is_donation: true
    }
    
    console.log('Sending donation request:', JSON.stringify(requestData, null, 2))
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/tbank-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify(requestData)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('T-Bank payment HTTP error:', response.status, errorText)
      await sendMessage(chatId, "❌ Ошибка создания платежа. Попробуй позже.")
      return
    }
    
    const paymentData = await response.json()
    
    if (paymentData.error) {
      console.error('T-Bank payment error:', paymentData.error)
      await sendMessage(chatId, "❌ Ошибка создания платежа. Попробуй позже.")
      return
    }
    
    if (!paymentData.payment_url) {
      console.error('No payment URL in response:', paymentData)
      await sendMessage(chatId, "❌ Ошибка создания платежа. Попробуй позже.")
      return
    }
    
    // Отправляем ссылку на оплату
    await sendMessage(
      chatId,
      `💝 **Поддержка проекта - ${amount}₽**\n\n` +
      `Спасибо за желание поддержать C.I.D.!\n\n` +
      `🔒 **Безопасная оплата через T-Bank**\n` +
      `✨ После оплаты ты получишь уведомление\n\n` +
      `👇 Нажми кнопку ниже для оплаты:`,
      {
        inline_keyboard: [
          [{ text: "💳 Оплатить", url: paymentData.payment_url }],
          [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
        ]
      }
    )
  } catch (error) {
    console.error('Error creating donation payment:', error)
    await sendMessage(chatId, "❌ Ошибка создания платежа. Попробуй позже.")
  }
}
/**
 * Главная функция обработки обновлений
 */
async function handleUpdate(update: TelegramUpdate) {
  try {
    if (update.message) {
      const message = update.message
      
      // Обработка команд
      if (message.text?.startsWith('/')) {
        const command = message.text.split(' ')[0].substring(1)
        
        if (command === 'start') {
          await handleStartCommand(message)
        }
      } else if (message.photo) {
        // Обработка фото
        await handlePhotoMessage(message)
      } else if (message.voice) {
        // Обработка голосовых сообщений
        await handleVoiceMessage(message)
      } else if (message.text) {
        await handleTextMessage(message)
      }
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query)
    }
  } catch (error) {
    console.error('Error handling update:', error)
  }
}
/**
 * Главный обработчик HTTP запросов
 */
serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    const update: TelegramUpdate = await req.json()
    console.log('Received update:', update.update_id)
    
    // ВАЖНО: Ждем завершения обработки перед ответом
    await handleUpdate(update)
    
    return new Response(
      JSON.stringify({ ok: true }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
