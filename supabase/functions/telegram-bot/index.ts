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

interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
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

// Функции для работы с состояниями через Supabase
async function getUserState(userId: number) {
  const { data } = await supabase
    .from('user_states')
    .select('*')
    .eq('telegram_id', userId)
    .single()
  
  if (data && data.state_data) {
    return { state: data.state_name, data: data.state_data }
  }
  return null
}

async function setUserState(userId: number, state: string, data: any) {
  await supabase
    .from('user_states')
    .upsert({
      telegram_id: userId,
      state_name: state,
      state_data: data,
      updated_at: new Date().toISOString()
    })
}

async function clearUserState(userId: number) {
  await supabase
    .from('user_states')
    .delete()
    .eq('telegram_id', userId)
}

/**
 * Отправка сообщения в Telegram
 */
async function sendMessage(chatId: number, text: string, replyMarkup?: any): Promise<any> {
  const payload: any = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  }
  
  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }
  
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  
  return await response.json()
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
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
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
    "adjustment_explanation": "объяснение корректировок"
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
          content: 'Ты C.I.D. - опытный диетолог. Помогаешь корректировать планы питания безопасно и эффективно.'
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
 * Форматирование карточки КБЖУ
 */
function formatNutritionCard(plan: any, profileData: any): string {
  return `📊 **КАРТОЧКА КБЖУ ДЛЯ ${profileData.name?.toUpperCase()}**

🔥 Калории: **${plan.calories}** ккал/день
🥩 Белки: **${plan.protein}** г
🥑 Жиры: **${plan.fats}** г
🍞 Углеводы: **${plan.carbs}** г
💧 Вода: **${plan.water}** л/день

📈 **Метаболизм:**
• Базовый (BMR): ${plan.bmr.toFixed(0)} ккал/день
• Общий расход (TDEE): ${plan.tdee.toFixed(0)} ккал/день

${plan.methodology_explanation}

💪 **Рекомендации по активности:**
${plan.activity_recommendations || 'Следуйте вашей текущей программе тренировок'}
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
  
  let welcomeMessage = `🤖 Привет! Я C.I.D. — Care • Insight • Discipline.
Твой AI-наставник по питанию и привычкам.
Я помогу тебе рассчитать рацион, вести учёт и не терять фокус.`
  
  if (!profile) {
    await sendMessage(message.chat.id, welcomeMessage, welcomeKeyboard())
  } else {
    welcomeMessage += `\n\n✅ Твой профиль уже создан!`
    await sendMessage(message.chat.id, welcomeMessage, {
      inline_keyboard: [
        [{ text: "📊 Мой план КБЖУ", callback_data: "show_card" }],
        [{ text: "✏️ Редактировать профиль", callback_data: "edit_profile" }]
      ]
    })
  }
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
    await editMessageText(
      chatId,
      messageId,
      "✅ Отлично! Теперь ты можешь:\n\n• Записывать что ты ел\n• Получать рекомендации по питанию\n• Отслеживать прогресс\n\nНапиши /help для подробной информации."
    )
  }
}

/**
 * Обработка текстовых сообщений
 */
async function handleTextMessage(message: TelegramMessage) {
  const userId = message.from.id
  const stateData = await getUserState(userId)
  
  if (!stateData) {
    await sendMessage(message.chat.id, "Используй /start для начала работы")
    return
  }
  
  const user = await getOrCreateUser(
    message.from.id,
    message.from.username,
    message.from.first_name
  )
  
  // Ожидание имени
  if (stateData.state === 'waiting_name') {
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
    stateData.data.wishes = message.text
    await setUserState(userId, stateData.state, stateData.data)
    
    await sendMessage(message.chat.id, "⏳ Создаю твой персональный план КБЖУ...")
    
    // Генерируем план через OpenAI
    try {
      const plan = await generateNutritionPlan(stateData.data)
      
      // Сохраняем профиль
      const { data: profile } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          ...stateData.data
        })
        .select()
        .single()
      
      // Сохраняем план
      await supabase
        .from('nutrition_plans')
        .update({ is_active: false })
        .eq('user_id', user.id)
      
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
      
      const cardText = formatNutritionCard(plan, stateData.data)
      await sendMessage(message.chat.id, cardText, nutritionCardKeyboard())
      
      await clearUserState(userId)
    } catch (error) {
      console.error('Error generating plan:', error)
      await sendMessage(message.chat.id, "❌ Ошибка создания плана. Попробуй еще раз /start")
    }
  }
  
  // Ожидание корректировки
  else if (stateData.state === 'waiting_adjustment') {
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
      
      // Обновляем план
      await supabase
        .from('nutrition_plans')
        .update({
          calories: adjusted.target_calories,
          protein: adjusted.protein_grams,
          fats: adjusted.fats_grams,
          carbs: adjusted.carbs_grams,
          water: adjusted.water_liters,
          methodology_explanation: currentPlan.methodology_explanation + '\n\n🔄 **Корректировка:**\n' + adjusted.adjustment_explanation
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
    
    handleUpdate(update).catch(err => console.error('Error in handleUpdate:', err))
    
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
