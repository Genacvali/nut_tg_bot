/**
 * Supabase Edge Function для обработки Telegram Webhook
 * C.I.D. Bot - Care • Insight • Discipline
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Типы для Telegram API
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
}

interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
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

// Получаем переменные окружения
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

// Инициализация Supabase клиента
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Telegram API базовый URL
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

// ========================================
// ОПРЕДЕЛЕНИЕ НАМЕРЕНИЯ ПОЛЬЗОВАТЕЛЯ
// ========================================

/**
 * Определяет намерение пользователя: это описание еды или вопрос?
 */
async function detectIntent(text: string): Promise<'food' | 'question'> {
  const lowerText = text.toLowerCase().trim()
  
  // ВАЖНО: Сначала проверяем СИЛЬНЫЕ индикаторы ЕДЫ
  // Это приоритет, потому что если есть граммы/продукты - это точно еда
  const strongFoodPatterns = [
    /\d+\s*(г|грам|мл|кг|шт)/i,  // есть граммы/мл/кг/шт - это точно запись еды!
    /(съел|поел|выпил|скушал|позавтракал|пообедал|поужинал)/i,
    /(завтрак|обед|ужин|перекус):/i,
  ]
  
  for (const pattern of strongFoodPatterns) {
    if (pattern.test(lowerText)) {
      console.log('Strong food indicator detected:', pattern)
      return 'food'
    }
  }
  
  // Явные ВОПРОСИТЕЛЬНЫЕ конструкции (начинается с вопросительного слова)
  const explicitQuestionPatterns = [
    /^(что|как|где|когда|почему|зачем|какой|какая|можно ли|стоит ли)/i,
    /\?$/,  // заканчивается на вопросительный знак
    /(посовет|подскаж|помог|расскаж|объясн|покаж)/i,
    /(можно съесть|что поесть|что приготовить|посоветуй|порекомендуй|дай рецепт|найди рецепт|покажи меню)/i
  ]
  
  for (const pattern of explicitQuestionPatterns) {
    if (pattern.test(lowerText)) {
      console.log('Explicit question detected:', pattern)
      return 'question'
    }
  }
  
  // Слабые индикаторы еды (названия продуктов)
  // Проверяем перед тем как классифицировать как вопрос
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
  if (hasFoodWords && lowerText.includes(',')) {
    console.log('Food products enumeration detected')
    return 'food'
  }
  
  // Если есть названия продуктов И сообщение короткое (<80 символов) - скорее всего еда
  if (hasFoodWords && lowerText.length < 80) {
    console.log('Short message with food products detected')
    return 'food'
  }
  
  // Если сообщение очень короткое (<30 символов) и нет явных вопросов - считаем едой
  if (lowerText.length < 30 && !lowerText.includes('?')) {
    console.log('Very short message, treating as food')
    return 'food'
  }
  
  // Если непонятно - считаем вопросом
  console.log('Defaulting to question')
  return 'question'
}

// Функции для работы с состояниями через Supabase
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
 * Отправка сообщения в Telegram
 */
async function sendMessage(chatId: number, text: string, replyMarkup?: any, parseMode: string = 'Markdown'): Promise<any> {
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
        model: 'gpt-4o-mini',
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
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 1000
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

/**
 * Корректировка плана на основе запроса пользователя
 */
async function adjustNutritionPlan(currentPlan: any, userRequest: string, profileData: any): Promise<any> {
  const prompt = `Ты - C.I.D., профессиональный диетолог. Клиент хочет скорректировать свой план питания.

Текущий план:
- Калории: ${currentPlan.calories} ккал
- Белки: ${currentPlan.protein} г
- Жиры: ${currentPlan.fats} г
- Углеводы: ${currentPlan.carbs} г
- Вода: ${currentPlan.water} л

Данные клиента:
- Имя: ${profileData.name}
- Возраст: ${profileData.age} лет
- Пол: ${profileData.gender === 'male' ? 'мужской' : 'женский'}
- Текущий вес: ${profileData.current_weight} кг

Запрос клиента: "${userRequest}"

Скорректируй план с учетом пожеланий. Верни результат в формате JSON:
{
    "target_calories": число,
    "protein_grams": число,
    "fats_grams": число,
    "carbs_grams": число,
    "water_liters": число,
    "adjustment_explanation": "короткое объяснение текущей корректировки (1-2 предложения)"
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
          content: 'Ты C.I.D. - опытный диетолог. Помогаешь корректировать планы питания безопасно и эффективно. НЕ повторяй предыдущие корректировки в adjustment_explanation.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
      max_tokens: 500
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
        { text: "💬 Диалог с C.I.D." },
        { text: "📊 Дневник" }
      ],
      [
        { text: "⚙️ Настройки" },
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
    `🥩 Белки: ${consumed.protein.toFixed(0)}/${plan.protein}г\n` +
    `🥑 Жиры: ${consumed.fats.toFixed(0)}/${plan.fats}г\n` +
    `🍞 Углеводы: ${consumed.carbs.toFixed(0)}/${plan.carbs}г\n\n` +
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
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()
    
    if (plan && profile) {
      const cardText = formatNutritionCard(plan, profile)
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
        `• 1 месяц — 99₽\n` +
        `• 6 месяцев — 499₽ (выгодно!)\n` +
        `• 1 год — 999₽ (супер выгодно!)\n\n` +
        `🚀 Начинай прямо сейчас!`
      
      await sendMessage(chatId, trialMessage, {
        inline_keyboard: [
          [{ text: "🚀 Начать пользоваться", callback_data: "main_menu" }]
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
        durationText = '3 месяца'
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
            [{ text: "💳 Оплатить", url: paymentData.paymentUrl }],
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
  
  // Управление приемами пищи
  else if (data === 'manage_meals') {
    await manageMeals(chatId, user.id)
  }
  
  // Удаление приема пищи (показать подтверждение)
  else if (data.startsWith('delete_meal_')) {
    const mealId = parseInt(data.split('_')[2])
    await deleteMeal(chatId, user.id, mealId)
  }
  
  // Подтверждение удаления приема пищи
  else if (data.startsWith('confirm_delete_meal_')) {
    const mealId = parseInt(data.split('_')[3])
    await confirmDeleteMeal(chatId, user.id, mealId)
  }
  
  // Редактирование приема пищи
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
    
    // Получаем профиль
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    
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
          `🔥 Калории: ${plan.target_calories} ккал\n` +
          `🍗 Белки: ${plan.protein_grams} г\n` +
          `🥑 Жиры: ${plan.fats_grams} г\n` +
          `🍞 Углеводы: ${plan.carbs_grams} г\n` +
          `💧 Вода: ${plan.water_liters} л`,
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
  const navigationButtons = ['🔙 Назад', '💬 Диалог с C.I.D.', '📊 Дневник', '⚙️ Настройки',
                              '📊 КБЖУ + Вода', '📝 Мои приемы пищи',
                              '👤 Профиль', '❓ Помощь', '💎 Подписка']
  
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
    } else {
      // Показываем заглушку с предложением перейти в Диалог
      await sendMessage(
        message.chat.id,
        `❓ **Похоже, ты хочешь задать вопрос!**\n\n` +
        `💬 Для обсуждения рациона, рецептов и советов по питанию перейди в раздел **"Диалог с C.I.D."**\n\n` +
        `📝 Здесь в обычном чате я записываю только приемы пищи.\n` +
        `Просто опиши что съел (например: "банан 150г, овсянка 60г")`,
        {
          inline_keyboard: [
            [{ text: "💬 Перейти к диалогу", callback_data: "menu_recipes" }],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
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
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()
      
      const { data: currentPlan } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single()
      
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
  
  // Редактирование конкретных параметров
  else if (stateData.state.startsWith('editing_')) {
    if (!message.text) return
    const param = stateData.state.replace('editing_', '')
    await handleParameterEdit(userId, message.chat.id, user.id, param, message.text)
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
    await handleRecipeRequest(userId, message.chat.id, user.id, message.text)
  }
  
  // Редактирование приема пищи
  else if (stateData.state === 'editing_meal') {
    if (!message.text) return
    await handleMealEdit(userId, message.chat.id, user.id, stateData.data.mealId, message.text)
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
      await clearUserState(message.from.id) // Очищаем состояние
      await sendMessage(chatId, "🏠 **Главное меню**", getMainKeyboard())
      break
    
    // Меню питания
    case '💬 Диалог с C.I.D.':
      await setUserState(message.from.id, 'requesting_recipe', {})
      await sendMessage(
        chatId,
        `💬 **Режим диалога активирован**\n\nПривет! Я твой AI-диетолог. Теперь все твои сообщения будут обрабатываться как вопросы о питании.\n\n✨ **Что я могу:**\n• Предложить рецепты с учетом КБЖУ\n• Составить меню на день/неделю\n• Дать совет по питанию\n• Помочь с выбором продуктов\n\n📝 **Записать еду?** Нажми "Главное меню" и просто напиши что съел в чат.\n\nЗадавай вопросы! 😊`,
        {
          inline_keyboard: [
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        }
      )
      break
    
    // Меню дневника
    case '📊 Дневник':
      await sendMessage(chatId, "📊 **Дневник**\n\nТвоя статистика и приемы пищи", getDiaryKeyboard())
      break
    
    case '📊 КБЖУ + Вода':
      await showDiary(chatId, user.id)
      break
    
    case '📝 Мои приемы пищи':
      await manageMeals(chatId, user.id)
      break
    
    // Меню настроек
    case '⚙️ Настройки':
      await sendMessage(chatId, "⚙️ **Настройки**\n\nУправление профилем и подпиской", getSettingsKeyboard())
      break
    
    case '👤 Профиль':
      await showProfileMenu(chatId, user.id)
      break
    
    case '❓ Помощь':
      await showHelpMenu(chatId, user.id)
      break
    
    case '💎 Подписка':
      await showSubscriptionMenu(chatId, user.id)
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Ты C.I.D. - AI-диетолог. Анализируешь питание и даешь рекомендации. ОБЯЗАТЕЛЬНО используй стандартные таблицы БЖУ для точных расчетов. Будь последовательным - одинаковые продукты всегда имеют одинаковую калорийность на 100г.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 500
      })
    })

    const data = await response.json()
    const analysis = JSON.parse(data.choices[0].message.content)
    
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
    
    const resultText = `✅ Прием пищи обновлен!

🔥 Калории: ${analysis.calories} ккал
🥩 Белки: ${analysis.protein}г
🥑 Жиры: ${analysis.fats}г
🍞 Углеводы: ${analysis.carbs}г${breakdownText}

💬 ${analysis.comment}`
    
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

⚠️ БУДЬ ПОСЛЕДОВАТЕЛЬНЫМ:
- Одинаковые продукты ВСЕГДА должны иметь одинаковую калорийность на 100г
- Используй точные данные из таблиц БЖУ, не придумывай значения
- Для "запеченного тунца" ВСЕГДА используй ~130-150 ккал/100г

Примеры:
✅ "тарелка супа 250мл, салат 350г" → есть вес, считай КБЖУ
✅ "банан 150г" → есть вес, считай
✅ "порция курицы 200г" → есть вес, считай
❌ "банан" → нет веса, запроси уточнение

⚠️ НИКОГДА не возвращай 0 калорий если есть информация о количестве!

Верни JSON:
{
  "need_clarification": true/false,
  "clarification_question": "вопрос если нужно уточнение",
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Ты C.I.D. - AI-диетолог. Анализируешь питание и даешь рекомендации. ОБЯЗАТЕЛЬНО используй стандартные таблицы БЖУ для точных расчетов. Будь последовательным - одинаковые продукты всегда имеют одинаковую калорийность на 100г.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 500
      })
    })

    const data = await response.json()
    console.log('OpenAI response for food logging:', JSON.stringify(data))
    
    const analysis = JSON.parse(data.choices[0].message.content)
    console.log('Parsed analysis:', JSON.stringify(analysis))
    
    // ВАЛИДАЦИЯ: Если calories === 0 или undefined, значит что-то пошло не так
    if (!analysis.calories || analysis.calories === 0) {
      console.error('Invalid analysis result - zero calories:', analysis)
      await sendMessage(chatId, "❌ Не удалось проанализировать еду. Попробуй описать более детально (укажи примерный вес продуктов).")
      await clearUserState(userId)
      return
    }
    
    // Разрешаем уточнение только один раз
    if (analysis.need_clarification && clarificationAttempt === 0) {
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
    
    const resultText = `✅ **Прием пищи записан!**

📝 ${foodDescription}

🔥 ${analysis.calories} ккал | 🥩 Б: ${analysis.protein}г | 🥑 Ж: ${analysis.fats}г | 🍞 У: ${analysis.carbs}г${breakdownText}

⏰ ${timeStr}
💬 ${analysis.comment}`
    
    // Post-action buttons: редактировать, удалить, статистика
    await sendMessage(chatId, resultText, {
      inline_keyboard: [
        [
          { text: "✏️ Изменить", callback_data: `edit_meal_${savedLog.id}` },
          { text: "🗑 Удалить", callback_data: `delete_meal_${savedLog.id}` }
        ],
        [
          { text: "📊 Статистика", callback_data: "diary" }
        ],
        [
          { text: "🍽 Записать еще", callback_data: "quick_log_food" }
        ]
      ]
    })
    
    await clearUserState(userId)
  } catch (error) {
    console.error('Error logging food:', error)
    await sendMessage(chatId, "❌ Ошибка записи. Попробуй еще раз.")
  }
}

/**
 * Обработка запроса рецепта
 */
async function handleRecipeRequest(userId: number, chatId: number, dbUserId: number, request: string) {
  try {
    await sendMessage(chatId, "⏳ Подбираю рецепт...")
    
    // Получаем план и записи за сегодня
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
    
    const prompt = `Ты - C.I.D., AI-диетолог. Помоги клиенту с питанием.

Запрос: "${request}"

Дневной план: ${plan.calories} ккал (Б: ${plan.protein}г, Ж: ${plan.fats}г, У: ${plan.carbs}г)
Съедено сегодня: ${consumed.calories} ккал (Б: ${consumed.protein}г, Ж: ${consumed.fats}г, У: ${consumed.carbs}г)
Последний прием: ${Math.round(timeSinceLastMeal)} минут назад

Задачи:
1. Если прием был недавно (<2ч) - предложи перекус/воду или спроси про эмоциональный голод
2. Если запрос про меню на день/неделю - составь план
3. Иначе - предложи рецепт с учетом остатка КБЖУ

ВАЖНО: В ответе клиенту НЕ упоминай точные цифры минут/часов с последнего приема. Говори обобщенно: "недавно поел", "давно не ел", "уже пора перекусить" и т.д.

Верни краткий ответ (до 500 символов) с рекомендацией.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Ты C.I.D. - AI-диетолог. Помогаешь с рецептами и планированием питания.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 700
      })
    })

    const data = await response.json()
    const recommendation = data.choices[0].message.content
    
    await sendMessage(chatId, `📋 ${recommendation}`, {
      inline_keyboard: [
        [{ text: "💬 Продолжить диалог", callback_data: "menu_recipes" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })
    
    // НЕ очищаем state - пользователь остается в режиме диалога
    // Он выйдет когда нажмет "Главное меню"
  } catch (error) {
    console.error('Error handling recipe request:', error)
    await sendMessage(chatId, "❌ Ошибка. Попробуй еще раз.")
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
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${message.voice!.file_id}`
    )
    const fileData = await fileResponse.json()
    
    if (!fileData.ok) {
      throw new Error('Failed to get file info')
    }
    
    // Скачиваем файл
    const filePath = fileData.result.file_path
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
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
Записывай приемы пищи текстом или голосом. AI анализирует блюда и показывает детальную разбивку по продуктам

💬 **AI-диетолог**
Отвечаю на вопросы о питании, предлагаю рецепты с учетом остатка КБЖУ, предупреждаю о переедании, планирую меню

📋 **Дневник питания**
Веду историю приемов пищи с визуализацией прогресса, статистикой воды и возможностью редактирования

🎤 **Голосовой ввод**
Поддерживаю голосовые сообщения - наговаривай вместо печати

✏️ **Гибкие настройки**
Корректируй план питания через AI, получай персональные советы и рекомендации

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
      [{ text: "💝 Поддержать проект", callback_data: "buy_subscription" }],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    ]
  })
}

/**
 * Показать меню профиля пользователя
 */
async function showProfileMenu(chatId: number, dbUserId: number) {
  try {
    // Получаем профиль и план
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', dbUserId)
      .single()
    
    const { data: plan } = await supabase
      .from('nutrition_plans')
      .select('*')
      .eq('user_id', dbUserId)
      .eq('is_active', true)
      .single()
    
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
      profileText += `🔥 Калории: ${plan.calories} ккал\n`
      profileText += `🍗 Белки: ${plan.protein} г\n`
      profileText += `🥑 Жиры: ${plan.fats} г\n`
      profileText += `🍞 Углеводы: ${plan.carbs} г\n`
      profileText += `💧 Вода: ${Math.round(plan.water * 1000)} мл\n\n`
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
        [{ text: "💝 Поддержать проект", callback_data: "buy_subscription" }],
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
        const time = new Date(log.logged_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        const shortDesc = log.description.length > 30 ? log.description.substring(0, 30) + '...' : log.description
        
        message += `**${mealIndex}.** ⏰ ${time} - ${shortDesc}\n`
        message += `   🔥 ${log.calories}ккал | Б:${log.protein}г | Ж:${log.fats}г | У:${log.carbs}г\n`
        
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
    
    let diaryText = `📊 **Дневник за ${new Date().toLocaleDateString('ru-RU')}**

**План на день:**
🔥 Калории: ${plan.calories} ккал
🥩 Белки: ${plan.protein}г
🥑 Жиры: ${plan.fats}г
🍞 Углеводы: ${plan.carbs}г
💧 Вода: ${plan.water}л

**Съедено:**
🔥 ${consumed.calories} / ${plan.calories} ккал (${Math.round(consumed.calories / plan.calories * 100)}%)
🥩 ${consumed.protein}г / ${plan.protein}г
🥑 ${consumed.fats}г / ${plan.fats}г
🍞 ${consumed.carbs}г / ${plan.carbs}г

**Осталось:**
🔥 ${plan.calories - consumed.calories} ккал
🥩 ${plan.protein - consumed.protein}г белка
🥑 ${plan.fats - consumed.fats}г жиров
🍞 ${plan.carbs - consumed.carbs}г углеводов`

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
    
    // Формируем клавиатуру
    const keyboard: any = {
      inline_keyboard: []
    }
    
    // Если есть приемы пищи, добавляем кнопку для управления ими
    if (todayLogs && todayLogs.length > 0) {
      keyboard.inline_keyboard.push([
        { text: "📝 Управление приемами", callback_data: "manage_meals" }
      ])
    }
    
    keyboard.inline_keyboard.push(
      [{ text: "✏️ Редактировать профиль", callback_data: "edit_profile" }],
      [{ text: "🔄 Скорректировать план", callback_data: "adjust_card" }],
      [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
    )
    
    await sendMessage(chatId, diaryText, keyboard)
  } catch (error) {
    console.error('Error showing diary:', error)
    await sendMessage(chatId, "❌ Ошибка загрузки дневника")
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
