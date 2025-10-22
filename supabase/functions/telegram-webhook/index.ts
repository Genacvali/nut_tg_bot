import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }
  
  try {
    const update = await req.json()
    
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const text = update.message.text
      const photo = update.message.photo
      
      // Обработка команд
      if (text?.startsWith('/start')) {
        await sendMessage(chatId, getWelcomeMessage())
        await ensureUser(userId, update.message.from.username)
        return success()
      }
      
      if (text?.startsWith('/help')) {
        await sendMessage(chatId, getHelpMessage())
        return success()
      }
      
      if (text?.startsWith('/stats')) {
        const stats = await getDailyStats(userId)
        await sendMessage(chatId, stats)
        return success()
      }
      
      if (text?.startsWith('/goals')) {
        await sendMessage(chatId, getGoalsMessage(userId))
        return success()
      }
      
      // Анализ текста
      if (text && !text.startsWith('/')) {
        await sendMessage(chatId, '🤔 Анализирую ваше сообщение...')
        const analysis = await analyzeFoodText(text)
        await saveMeal(userId, analysis)
        await sendMessage(chatId, formatAnalysis(analysis))
        return success()
      }
      
      // Анализ фото
      if (photo && photo.length > 0) {
        await sendMessage(chatId, '📷 Анализирую фото еды...')
        const fileId = photo[photo.length - 1].file_id
        const fileUrl = await getFileUrl(fileId)
        const analysis = await analyzePhoto(fileUrl)
        await saveMeal(userId, analysis)
        await sendMessage(chatId, formatAnalysis(analysis))
        return success()
      }
    }
    
    return success()
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

function success() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

async function ensureUser(userId: number, username?: string) {
  const { data } = await supabase
    .from('users')
    .select('user_id')
    .eq('user_id', userId)
    .single()
  
  if (!data) {
    await supabase.from('users').insert({
      user_id: userId,
      username: username,
      calories_goal: 2000,
      protein_goal: 150,
      carbs_goal: 200,
      fat_goal: 70
    })
  }
}

async function analyzeFoodText(text: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Ты нутрициолог. Анализируй описание еды и определяй КБЖУ. Отвечай ТОЛЬКО в JSON: {"name": "название", "calories": число, "protein": число, "carbs": число, "fat": число, "weight": число}'
        },
        { role: 'user', content: `Проанализируй это описание еды: ${text}` }
      ],
      max_tokens: 200
    })
  })
  
  const data = await response.json()
  const content = data.choices[0].message.content
  return JSON.parse(content)
}

async function analyzePhoto(fileUrl: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Проанализируй фото еды. Определи название и КБЖУ на 100г. Ответь ТОЛЬКО в JSON: {"name": "название", "calories": число, "protein": число, "carbs": число, "fat": число, "weight": число}'
            },
            {
              type: 'image_url',
              image_url: { url: fileUrl }
            }
          ]
        }
      ],
      max_tokens: 300
    })
  })
  
  const data = await response.json()
  const content = data.choices[0].message.content
  return JSON.parse(content)
}

async function getFileUrl(fileId: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function saveMeal(userId: number, analysis: any) {
  await supabase.from('meals').insert({
    user_id: userId,
    meal_name: analysis.name,
    calories: analysis.calories,
    protein: analysis.protein,
    carbs: analysis.carbs,
    fat: analysis.fat
  })
}

async function getDailyStats(userId: number) {
  const today = new Date().toISOString().split('T')[0]
  
  const { data: meals } = await supabase
    .from('meals')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`)
  
  if (!meals || meals.length === 0) {
    return '📊 Сегодня еще нет записей о еде.'
  }
  
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  const total = meals.reduce((acc, meal) => ({
    calories: acc.calories + meal.calories,
    protein: acc.protein + meal.protein,
    carbs: acc.carbs + meal.carbs,
    fat: acc.fat + meal.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  
  return `📊 Статистика за сегодня:

🔥 Калории: ${total.calories} / ${user?.calories_goal || 2000}
🥩 Белки: ${total.protein.toFixed(1)}г / ${user?.protein_goal || 150}г
🍞 Углеводы: ${total.carbs.toFixed(1)}г / ${user?.carbs_goal || 200}г
🥑 Жиры: ${total.fat.toFixed(1)}г / ${user?.fat_goal || 70}г

📝 Приемов пищи: ${meals.length}`
}

function getGoalsMessage(userId: number) {
  return `🎯 Управление целями по КБЖУ:

Используйте команды:
/setgoals - изменить цели
/today - прогресс за сегодня`
}

function formatAnalysis(analysis: any) {
  return `✅ Добавлено в дневник:

🍽️ ${analysis.name}
🔥 ${analysis.calories} ккал
🥩 ${analysis.protein}г белка
🍞 ${analysis.carbs}г углеводов
🥑 ${analysis.fat}г жиров`
}

function getWelcomeMessage() {
  return `🍎 Добро пожаловать в бота-нутрициолога!

Я помогу вам отслеживать питание и КБЖУ. Отправьте мне:
📝 Текст о том, что вы ели
📷 Фото еды
🎤 Голосовое сообщение

Вечером я пришлю отчет по дню!`
}

function getHelpMessage() {
  return `🍎 Помощь по боту-нутрициологу:

📝 Отправьте текст: "Я ел борщ и хлеб"
📷 Отправьте фото еды для анализа
🎤 Отправьте голосовое сообщение

Команды:
/start - Начать работу с ботом
/help - Показать эту справку
/stats - Показать статистику за сегодня
/goals - Настроить цели по КБЖУ

Вечером в 21:00 я автоматически пришлю отчет!`
}
