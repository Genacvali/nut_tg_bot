// Упрощённая версия основного файла Telegram бота
// Без внешних импортов для совместимости с Supabase Edge Functions

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
    
    // Обработка callback_query (нажатия на inline кнопки)
    if (update.callback_query) {
      const callbackQuery = update.callback_query
      const chatId = callbackQuery.message.chat.id
      const userId = callbackQuery.from.id
      const data = callbackQuery.data
      
      // Подтверждаем получение callback
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id })
      })
      
      // Обрабатываем callback
      await handleCallbackQuery(chatId, userId, data)
      
      return success()
    }
    
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const text = update.message.text
      const photo = update.message.photo
      const voice = update.message.voice
      
      // Обработка команд
      if (text?.startsWith('/start')) {
        await ensureUser(userId, update.message.from.username)
        await sendMessage(chatId, '🍎 Добро пожаловать в AI бота-нутрициолога!\n\nЯ ваш персональный помощник по питанию. Отправьте описание еды, фото или голосовое сообщение!')
        return success()
      }
      
      if (text?.startsWith('/menu')) {
        await sendMessageWithInlineKeyboard(chatId, '🍎 Главное меню\n\nВыберите действие:', getMainMenuKeyboard())
        return success()
      }
      
      if (text?.startsWith('/help')) {
        await sendMessage(chatId, '❓ Помощь по боту\n\n• Отправляйте описание еды: "ел курицу с рисом"\n• Фотографируйте блюда\n• Используйте голосовые сообщения\n• Настраивайте напоминания')
        return success()
      }
      
      // Обработка голосовых сообщений
      if (voice) {
        await sendMessage(chatId, '🎤 Обрабатываю голосовое сообщение...')
        
        try {
          const fileId = voice.file_id
          const fileUrl = await getFileUrl(fileId)
          const transcribedText = await transcribeVoice(fileUrl)
          
          if (transcribedText) {
            await sendMessage(chatId, `📝 Распознано: "${transcribedText}"`)
            
            // Простая обработка намерений
            if (transcribedText.toLowerCase().includes('добавь') || transcribedText.toLowerCase().includes('ел')) {
              await sendMessage(chatId, '🍽️ Добавляю приём пищи в дневник!')
            } else if (transcribedText.toLowerCase().includes('вес')) {
              await sendMessage(chatId, '⚖️ Обновляю вес!')
            } else {
              await sendMessage(chatId, '🤔 Не совсем понял. Попробуйте сказать: "Добавь курицу 200 ккал" или "Обнови вес 75 кг"')
            }
          } else {
            await sendMessage(chatId, '❌ Не удалось распознать голосовое сообщение')
          }
        } catch (error) {
          console.error('Voice processing error:', error)
          await sendMessage(chatId, '❌ Ошибка при обработке голосового сообщения')
        }
        
        return success()
      }
      
      // Обработка текстовых сообщений
      if (text && !text.startsWith('/')) {
        await handleTextMessage(userId, chatId, text)
        return success()
      }
      
      // Обработка фото
      if (photo && photo.length > 0) {
        await sendMessage(chatId, '📷 Анализирую фото еды...')
        // Здесь будет анализ фото через OpenAI
        await sendMessage(chatId, '✅ Фото проанализировано! Добавлено в дневник.')
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

// Вспомогательные функции

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

async function sendMessageWithInlineKeyboard(chatId: number, text: string, keyboard: any) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML',
      reply_markup: keyboard
    })
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

async function getFileUrl(fileId: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function transcribeVoice(fileUrl: string): Promise<string | null> {
  try {
    // Скачиваем аудио файл
    const audioResponse = await fetch(fileUrl)
    const audioBlob = await audioResponse.blob()
    
    // Создаем FormData для Whisper API
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    })
    
    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`)
    }
    
    const text = await response.text()
    return text.trim()
  } catch (error) {
    console.error('Transcription error:', error)
    return null
  }
}

async function handleCallbackQuery(chatId: number, userId: number, data: string) {
  // Простая обработка callback query
  switch (data) {
    case 'menu_main':
      await sendMessageWithInlineKeyboard(chatId, '🍎 Главное меню\n\nВыберите действие:', getMainMenuKeyboard())
      break
    case 'menu_profile':
      await sendMessage(chatId, '👤 Профиль\n\nЗдесь будут настройки профиля')
      break
    case 'menu_calculate':
      await sendMessage(chatId, '📊 Расчёт КБЖУ\n\nЗдесь будет расчёт персонального плана')
      break
    case 'menu_today':
      await sendMessage(chatId, '📅 Сегодня\n\nЗдесь будет дневной рацион')
      break
    case 'menu_reminders':
      await sendMessage(chatId, '⏰ Напоминания\n\nЗдесь будут настройки напоминаний')
      break
    case 'menu_help':
      await sendMessage(chatId, '❓ Помощь\n\nИспользуйте команды /start, /menu, /help')
      break
    default:
      await sendMessage(chatId, 'Неизвестная команда')
  }
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '👤 Профиль', callback_data: 'menu_profile' },
        { text: '📊 Рассчитать КБЖУ', callback_data: 'menu_calculate' }
      ],
      [
        { text: '📅 Сегодня', callback_data: 'menu_today' },
        { text: '⏰ Напоминания', callback_data: 'menu_reminders' }
      ],
      [
        { text: '❓ Помощь', callback_data: 'menu_help' }
      ]
    ]
  }
}

async function handleTextMessage(userId: number, chatId: number, text: string) {
  // Простая обработка текстовых сообщений
  if (text.toLowerCase().includes('ел') || text.toLowerCase().includes('съел') || text.toLowerCase().includes('поел')) {
    await sendMessage(chatId, '🍽️ Анализирую ваше сообщение...')
    
    // Простой анализ еды
    const analysis = await analyzeFoodText(text)
    await saveMeal(userId, analysis)
    
    await sendMessage(chatId, `✅ Добавлено в дневник:\n\n🍽️ ${analysis.name}\n🔥 ${analysis.calories} ккал\n🥩 ${analysis.protein}г белка\n🍞 ${analysis.carbs}г углеводов\n🥑 ${analysis.fat}г жиров`)
  } else {
    await sendMessage(chatId, '🤔 Не понял. Попробуйте описать что вы ели, например: "ел курицу с рисом"')
  }
}

async function analyzeFoodText(text: string) {
  // Простой анализ еды - в реальной версии здесь будет OpenAI
  return {
    name: text,
    calories: 300,
    protein: 20,
    carbs: 30,
    fat: 10,
    weight: 200
  }
}

async function saveMeal(userId: number, analysis: any) {
  await supabase.from('meals').insert({
    user_id: userId,
    meal_name: analysis.name,
    kcal: analysis.calories,
    protein: analysis.protein,
    carbs: analysis.carbs,
    fat: analysis.fat,
    weight_grams: analysis.weight
  })
}
