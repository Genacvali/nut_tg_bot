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
    
    // Пока убираем callback_query обработку - теперь используем Reply Keyboard
    
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const text = update.message.text
      const photo = update.message.photo
      
      // Обработка команд
      if (text?.startsWith('/start')) {
        await ensureUser(userId, update.message.from.username)
        const user = await getUser(userId)
        
        if (!user || !user.height) {
          // Первый запуск - запрашиваем параметры
          await sendMessage(chatId, getInitialSetupMessage())
        } else {
          // Пользователь уже настроен
          await sendMessageWithKeyboard(chatId, getWelcomeMessage(), getMainKeyboard())
        }
        return success()
      }
      
      if (text?.startsWith('/menu') || text?.startsWith('/help')) {
        await sendMessageWithKeyboard(chatId, getHelpMessage(), getMainKeyboard())
        return success()
      }
      
      // Обработка кнопок меню
      if (text === '📊 Статистика' || text?.startsWith('/stats')) {
        const stats = await getDailyStats(userId)
        await sendMessageWithKeyboard(chatId, stats, getMainKeyboard())
        return success()
      }
      
      if (text === '🥘 Что поесть?' || text?.startsWith('/recipe')) {
        await sendMessage(chatId, '🤔 Анализирую ваш рацион и подбираю рекомендации...')
        const advice = await getSmartAdvice(userId, 'что мне поесть сейчас?')
        await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
        return success()
      }
      
      if (text === '↩️ Отменить последнее' || text?.startsWith('/undo')) {
        const result = await undoLastMeal(userId)
        await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        return success()
      }
      
      if (text === '⚙️ Мои параметры' || text?.startsWith('/params')) {
        const user = await getUser(userId)
        if (user) {
          const paramsText = getUserParamsText(user)
          await sendMessageWithKeyboard(chatId, paramsText, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Сначала используйте /start')
        }
        return success()
      }
      
      // Синхронизация данных Apple Watch / Apple Health
      if (text?.startsWith('/sync_weight ')) {
        const weight = parseFloat(text.split(' ')[1])
        if (weight && weight > 30 && weight < 300) {
          await syncHealthData(userId, 'weight', weight)
          await sendMessageWithKeyboard(chatId, `✅ Вес записан: ${weight} кг\n\n⌚ Используйте Apple Shortcuts для автоматической синхронизации!`, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите корректный вес: /sync_weight 75.5')
        }
        return success()
      }

      if (text?.startsWith('/sync_steps ')) {
        const steps = parseInt(text.split(' ')[1])
        if (steps && steps > 0 && steps < 100000) {
          await syncHealthData(userId, 'steps', steps)
          let message = `✅ Шаги записаны: ${steps.toLocaleString()} 👟`
          
          // Мотивация в зависимости от количества шагов
          if (steps >= 15000) {
            message += `\n\n🔥 Отлично! Это высокая активность!\nДобавил +300 ккал к вашей дневной норме.`
          } else if (steps >= 10000) {
            message += `\n\n👍 Хорошо! Цель 10000 шагов достигнута!`
          } else if (steps >= 5000) {
            message += `\n\n💪 Неплохо, но давайте стремиться к 10000!`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите количество шагов: /sync_steps 12000')
        }
        return success()
      }

      if (text?.startsWith('/sync_sleep ')) {
        const sleep = parseFloat(text.split(' ')[1])
        if (sleep && sleep > 0 && sleep < 24) {
          await syncHealthData(userId, 'sleep_hours', sleep)
          let message = `✅ Сон записан: ${sleep}ч 🛌`
          
          // Советы в зависимости от продолжительности сна
          if (sleep < 6) {
            message += `\n\n⚠️ Мало сна! Организм в стрессе.\nДобавил +200 ккал к норме для восстановления.`
          } else if (sleep >= 7 && sleep <= 9) {
            message += `\n\n✅ Идеальный сон! Отлично для восстановления!`
          } else if (sleep > 9) {
            message += `\n\n😴 Много сна - возможно, нужен отдых?`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите часы сна: /sync_sleep 7.5')
        }
        return success()
      }

      if (text?.startsWith('/sync_calories ')) {
        const calories = parseInt(text.split(' ')[1])
        if (calories && calories > 0 && calories < 5000) {
          await syncHealthData(userId, 'active_calories', calories)
          let message = `✅ Активность записана: ${calories} ккал 🔥`
          
          if (calories >= 500) {
            message += `\n\n💪 Интенсивная тренировка!\nДобавил ${calories} ккал к вашей дневной норме.`
          } else if (calories >= 300) {
            message += `\n\n👍 Хорошая активность!`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите сожженные калории: /sync_calories 450')
        }
        return success()
      }
      
      // Анализ текста
      if (text && !text.startsWith('/')) {
        // Проверяем, это параметры пользователя или цель
        const isUserParams = text.toLowerCase().includes('см') || 
                            text.toLowerCase().includes('кг') ||
                            text.toLowerCase().includes('вешу') ||
                            text.toLowerCase().includes('рост') ||
                            text.toLowerCase().includes('сбросить') ||
                            text.toLowerCase().includes('набрать') ||
                            text.toLowerCase().includes('зал') ||
                            text.toLowerCase().includes('тренировки')
        
        if (isUserParams) {
          // Обновляем параметры пользователя
          await sendMessage(chatId, '📝 Обновляю ваши параметры и цели...')
          const result = await updateUserParams(userId, text)
          await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        } else {
          // Проверяем, спрашивает ли пользователь совет
          const isQuestion = text.toLowerCase().includes('что') || 
                            text.toLowerCase().includes('посоветуй') ||
                            text.toLowerCase().includes('предложи') ||
                            text.toLowerCase().includes('?')
          
          if (isQuestion) {
            // Даем совет или рецепт
            await sendMessage(chatId, '🤔 Анализирую ваш рацион и подбираю рекомендации...')
            const advice = await getSmartAdvice(userId, text)
            await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
          } else {
            // Обычный анализ еды
            await sendMessage(chatId, '🤔 Анализирую ваше сообщение...')
            const analysis = await analyzeFoodText(text)
            await saveMeal(userId, analysis)
            
            // Даем анализ + совет
            const advice = await getAdviceAfterMeal(userId, analysis)
            await sendMessageWithKeyboard(chatId, formatAnalysis(analysis) + '\n\n' + advice, getMainKeyboard())
          }
        }
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
      
      // Анализ голоса
      if (update.message.voice) {
        await sendMessage(chatId, '🎤 Обрабатываю голосовое сообщение...')
        const fileId = update.message.voice.file_id
        const fileUrl = await getFileUrl(fileId)
        const text = await transcribeVoice(fileUrl)
        
        if (text) {
          await sendMessage(chatId, `📝 Распознано: ${text}`)
          const analysis = await analyzeFoodText(text)
          await saveMeal(userId, analysis)
          await sendMessage(chatId, formatAnalysis(analysis))
        } else {
          await sendMessage(chatId, '❌ Не удалось распознать голосовое сообщение')
        }
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

async function sendMessageWithKeyboard(chatId: number, text: string, keyboard: any) {
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

function getMainKeyboard() {
  return {
    keyboard: [
      [
        { text: '📊 Статистика' },
        { text: '🥘 Что поесть?' }
      ],
      [
        { text: '⚙️ Мои параметры' },
        { text: '↩️ Отменить последнее' }
      ]
    ],
    resize_keyboard: true,
    persistent: true
  }
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
  try {
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
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid OpenAI response')
    }
    
    const content = data.choices[0].message.content
    
    // Пытаемся распарсить JSON
    try {
      return JSON.parse(content)
    } catch (jsonError) {
      // Если не JSON, пытаемся извлечь данные из текста
      console.error('JSON parse error:', jsonError)
      return parseTextResponse(content)
    }
  } catch (error) {
    console.error('Analysis error:', error)
    return {
      name: 'Неизвестное блюдо',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      weight: 100
    }
  }
}

function parseTextResponse(text: string) {
  // Простой парсер для извлечения чисел из текста
  const numbers = text.match(/\d+\.?\d*/g) || []
  return {
    name: 'Анализ блюда',
    calories: parseInt(numbers[0] || '0') || 0,
    protein: parseFloat(numbers[1] || '0') || 0,
    carbs: parseFloat(numbers[2] || '0') || 0,
    fat: parseFloat(numbers[3] || '0') || 0,
    weight: parseInt(numbers[4] || '100') || 100
  }
}

async function analyzePhoto(fileUrl: string) {
  try {
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
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid OpenAI response')
    }
    
    const content = data.choices[0].message.content
    
    try {
      return JSON.parse(content)
    } catch (jsonError) {
      console.error('JSON parse error:', jsonError)
      return parseTextResponse(content)
    }
  } catch (error) {
    console.error('Photo analysis error:', error)
    return {
      name: 'Неизвестное блюдо с фото',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      weight: 100
    }
  }
}

async function getFileUrl(fileId: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function transcribeVoice(fileUrl: string) {
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
    
    const data = await response.json()
    return data.text || null
  } catch (error) {
    console.error('Transcription error:', error)
    return null
  }
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
  
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  // Получаем данные Apple Watch
  const healthData = await getHealthData(userId)
  
  if (!meals || meals.length === 0) {
    let message = '📊 Сегодня еще нет записей о еде.'
    
    // Показываем данные Apple Watch даже если еды нет
    if (healthData) {
      message += `\n\n⌚ Данные Apple Watch:`
      if (healthData.steps) message += `\n👟 Шаги: ${healthData.steps.toLocaleString()}`
      if (healthData.sleep_hours) message += `\n🛌 Сон: ${healthData.sleep_hours}ч`
      if (healthData.active_calories) message += `\n🔥 Активность: ${healthData.active_calories} ккал`
      if (healthData.weight) message += `\n⚖️ Вес: ${healthData.weight} кг`
    }
    
    return message
  }
  
  const total = meals.reduce((acc, meal) => ({
    calories: acc.calories + meal.calories,
    protein: acc.protein + meal.protein,
    carbs: acc.carbs + meal.carbs,
    fat: acc.fat + meal.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  
  // Рассчитываем скорректированную норму калорий
  const baseCalories = user?.calories_goal || 2000
  const adjustedCalories = calculateAdjustedCalories(baseCalories, healthData)
  
  let caloriesText = `🔥 Калории: ${total.calories} / ${baseCalories}`
  if (adjustedCalories !== baseCalories) {
    caloriesText += ` (+${adjustedCalories - baseCalories} за активность)`
  }
  
  let message = `📊 Статистика за сегодня:

${caloriesText}
🥩 Белки: ${total.protein.toFixed(1)}г / ${user?.protein_goal || 150}г
🍞 Углеводы: ${total.carbs.toFixed(1)}г / ${user?.carbs_goal || 200}г
🥑 Жиры: ${total.fat.toFixed(1)}г / ${user?.fat_goal || 70}г

📝 Приемов пищи: ${meals.length}`

  // Добавляем данные Apple Watch
  if (healthData) {
    message += `\n\n⌚ Данные Apple Watch:`
    if (healthData.steps) {
      const emoji = healthData.steps >= 10000 ? '✅' : healthData.steps >= 5000 ? '👍' : '💪'
      message += `\n${emoji} Шаги: ${healthData.steps.toLocaleString()}`
    }
    if (healthData.sleep_hours) {
      const emoji = healthData.sleep_hours >= 7 ? '✅' : healthData.sleep_hours >= 6 ? '😴' : '⚠️'
      message += `\n${emoji} Сон: ${healthData.sleep_hours}ч`
    }
    if (healthData.active_calories) {
      message += `\n🔥 Активность: ${healthData.active_calories} ккал`
    }
    if (healthData.weight) {
      message += `\n⚖️ Вес: ${healthData.weight} кг`
    }
    
    message += `\n\n💡 Синхронизация:\n/sync_weight • /sync_steps • /sync_sleep • /sync_calories`
  } else {
    message += `\n\n⌚ Подключите Apple Watch:\n/sync_weight 75.5 • /sync_steps 12000`
  }
  
  return message
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

function getHelpMessage() {
  return `🍎 Помощь по боту-нутрициологу:

📝 Отправьте текст: "Я ел борщ и хлеб"
📷 Отправьте фото еды для анализа
🎤 Отправьте голосовое сообщение

Команды:
/start - Начать работу с ботом
/menu - Главное меню с кнопками
/help - Показать эту справку
/stats - Показать статистику за сегодня
/goals - Настроить цели по КБЖУ
/recipe - Предложить рецепт
/undo - Удалить последний прием пищи

Вечером в 21:00 я автоматически пришлю отчет!`
}

async function undoLastMeal(userId: number) {
  try {
    const { data: lastMeal } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    if (!lastMeal) {
      return '❌ Нет приемов пищи для удаления'
    }
    
    await supabase
      .from('meals')
      .delete()
      .eq('id', lastMeal.id)
    
    return `✅ Удалено: ${lastMeal.meal_name} (${lastMeal.calories} ккал)`
  } catch (error) {
    console.error('Undo error:', error)
    return '❌ Ошибка при удалении'
  }
}

async function getRecipeSuggestion(userId: number) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) {
      return '❌ Сначала используйте /start'
    }
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
    
    const total = meals?.reduce((acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + meal.protein,
      carbs: acc.carbs + meal.carbs,
      fat: acc.fat + meal.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    const prompt = `Предложи простой рецепт блюда, которое:
- Содержит примерно ${remaining.calories} ккал (можно меньше)
- Белка: ${remaining.protein.toFixed(1)}г
- Углеводов: ${remaining.carbs.toFixed(1)}г
- Жиров: ${remaining.fat.toFixed(1)}г

Формат ответа:
🍽️ Название блюда

Ингредиенты:
- список ингредиентов

Приготовление:
краткое описание

КБЖУ на порцию: XXX ккал, XXг/XXг/XXг`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Ты опытный нутрициолог и повар. Предлагай простые и вкусные рецепты.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    })
    
    const data = await response.json()
    const recipe = data.choices?.[0]?.message?.content || 'Не удалось получить рецепт'
    
    return `🥘 Рецепт на основе ваших целей:\n\nОсталось до цели: ${remaining.calories} ккал\n\n${recipe}`
  } catch (error) {
    console.error('Recipe error:', error)
    return '❌ Ошибка при получении рецепта. Попробуйте позже.'
  }
}

async function getAdviceAfterMeal(userId: number, meal: any) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) return ''
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
    
    const total = meals?.reduce((acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    let advice = '💡 Совет:\n'
    
    if (remaining.calories < 0) {
      advice += `⚠️ Превышение по калориям на ${Math.abs(remaining.calories)} ккал. Будьте осторожны до конца дня!`
    } else if (remaining.calories < 500) {
      advice += `✅ Осталось ${remaining.calories} ккал до цели. Хороший прогресс!`
    } else {
      advice += `📊 Осталось ${remaining.calories} ккал. `
      
      if (remaining.protein > 30) {
        advice += `Не хватает белка (${remaining.protein.toFixed(0)}г) - добавьте курицу, творог или яйца. `
      }
      if (remaining.carbs < 50 && remaining.protein < 20) {
        advice += `Можете добавить легкий перекус с углеводами.`
      }
    }
    
    return advice
  } catch (error) {
    console.error('Advice error:', error)
    return ''
  }
}

async function updateUserParams(userId: number, text: string) {
  try {
    const prompt = `Извлеки параметры пользователя из текста: "${text}"

Найди:
- Рост в см
- Вес в кг  
- Цель (сбросить/набрать вес)
- Количество кг для сброса/набора
- Активность (зал, тренировки, спорт)
- Возраст (если указан)

Ответь ТОЛЬКО в JSON:
{
  "height": число_см,
  "weight": число_кг,
  "goal": "lose" или "gain",
  "target_weight": число_кг,
  "activity": "high" или "medium" или "low",
  "age": число_лет_или_null
}

Если чего-то нет, поставь null.`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Ты извлекаешь параметры пользователя из текста. Отвечай только в JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200
      })
    })
    
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    const params = JSON.parse(content)
    
    // Вычисляем цели по КБЖУ на основе параметров
    const goals = calculateNutritionGoals(params)
    
    // Обновляем пользователя в базе
    await supabase
      .from('users')
      .update({
        height: params.height,
        weight: params.weight,
        goal: params.goal,
        target_weight: params.target_weight,
        activity: params.activity,
        calories_goal: goals.calories,
        protein_goal: goals.protein,
        carbs_goal: goals.carbs,
        fat_goal: goals.fat
      })
      .eq('user_id', userId)
    
    // Генерируем план рациона
    const mealPlan = await generateMealPlan(params, goals)
    
    return `✅ Отлично! Я составил ваш персональный план!

📋 Ваши параметры:
📏 Рост: ${params.height} см
⚖️ Вес: ${params.weight} кг
🎯 Цель: ${params.goal === 'lose' ? 'Сбросить' : params.goal === 'gain' ? 'Набрать' : 'Поддержать'} ${params.target_weight ? Math.abs(params.target_weight - params.weight) + ' кг' : 'вес'}
🏋️ Активность: ${params.activity === 'high' ? 'Высокая (зал 3-5 раз)' : params.activity === 'medium' ? 'Средняя (1-2 раза)' : 'Низкая'}

📊 Ваши цели на день:
🔥 Калории: ${goals.calories}
🥩 Белки: ${goals.protein}г
🍞 Углеводы: ${goals.carbs}г
🥑 Жиры: ${goals.fat}г

${mealPlan}

Готово! Теперь просто отправляйте мне что едите, и я буду следить за вашим прогрессом! 🎯`
  } catch (error) {
    console.error('Update params error:', error)
    return '❌ Не удалось обновить параметры. Попробуйте еще раз.'
  }
}

async function generateMealPlan(params: any, goals: any) {
  try {
    const goalText = params.goal === 'lose' ? 'похудение' : params.goal === 'gain' ? 'набор массы' : 'поддержание веса'
    
    const prompt = `Составь примерный план рациона на день для человека:
- Вес: ${params.weight}кг
- Цель: ${goalText}
- Активность: ${params.activity === 'high' ? 'высокая (тренировки)' : 'средняя'}
- Калории: ${goals.calories}
- Белки: ${goals.protein}г
- Углеводы: ${goals.carbs}г
- Жиры: ${goals.fat}г

Формат ответа (БЕЗ markdown, только эмодзи и текст):

🍽️ ПРИМЕРНЫЙ ПЛАН РАЦИОНА:

🌅 Завтрак (7:00-9:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

🥗 Обед (13:00-14:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

🍖 Ужин (19:00-20:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

💡 Совет: [короткий совет по питанию]`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Ты опытный нутрициолог. Составляй простые и реалистичные планы питания. НЕ используй markdown.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    })
    
    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (error) {
    console.error('Meal plan error:', error)
    return `🍽️ ПРИМЕРНЫЙ ПЛАН РАЦИОНА:

🌅 Завтрак: Овсянка с фруктами, яйца
🥗 Обед: Курица с рисом и овощами
🍖 Ужин: Рыба с салатом

Я буду помогать вам следовать этому плану!`
  }
}

function calculateNutritionGoals(params: any) {
  // Базовый метаболизм (формула Миффлина-Сан Жеора)
  let bmr = 10 * params.weight + 6.25 * params.height - 5 * 30 + 5 // мужчина 30 лет
  
  // Коэффициент активности
  let activityMultiplier = 1.2
  if (params.activity === 'high') activityMultiplier = 1.7
  else if (params.activity === 'medium') activityMultiplier = 1.5
  
  let calories = Math.round(bmr * activityMultiplier)
  
  // Корректировка на цель
  if (params.goal === 'lose') {
    calories -= 500 // дефицит для похудения
  } else if (params.goal === 'gain') {
    calories += 300 // профицит для набора
  }
  
  // Макросы
  const protein = Math.round(params.weight * 2.2) // 2.2г на кг веса для тренирующихся
  const carbs = Math.round(calories * 0.4 / 4) // 40% от калорий
  const fat = Math.round(calories * 0.25 / 9) // 25% от калорий
  
  return { calories, protein, carbs, fat }
}

async function getSmartAdvice(userId: number, question: string) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) {
      return '❌ Сначала используйте /start'
    }
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
    
    const mealsList = meals?.map(m => `${m.meal_name} (${m.calories} ккал, ${m.protein}г белка)`).join(', ') || 'ничего'
    
    const total = meals?.reduce((acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    const userInfo = user.height ? `Пользователь: ${user.height}см, ${user.weight}кг, цель ${user.goal === 'lose' ? 'сбросить' : 'набрать'} вес` : ''
    
    const prompt = `Ты нутрициолог в Telegram. Пользователь спрашивает: "${question}"

${userInfo}

Сегодня он уже ел: ${mealsList}
Съедено: ${total.calories} ккал, ${total.protein.toFixed(0)}г белка, ${total.carbs.toFixed(0)}г углеводов, ${total.fat.toFixed(0)}г жиров

Цели на день: ${user.calories_goal} ккал, ${user.protein_goal}г белка, ${user.carbs_goal}г углеводов, ${user.fat_goal}г жиров

Осталось до цели: ${remaining.calories} ккал, ${remaining.protein.toFixed(0)}г белка

ВАЖНО: Форматирование для Telegram!
- НЕ используй markdown (* _ -)
- НЕ используй **жирный** или *курсив*
- Используй только эмодзи и простой текст
- Короткие абзацы

Дай совет в таком формате:

📋 Анализ:
[короткое резюме что он ел и чего не хватает]

🍽️ Вариант 1: [название]
• [ингредиенты одной строкой]
• КБЖУ: 300 ккал, 20б/30у/10ж
• [почему это подходит]

🍽️ Вариант 2: [название]
• [ингредиенты одной строкой]
• КБЖУ: 250 ккал, 15б/25у/12ж
• [почему это подходит]

💡 Главный совет:
[что важнее всего сейчас]`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Ты опытный и дружелюбный нутрициолог. Даешь персональные советы по питанию.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600
      })
    })
    
    const data = await response.json()
    const advice = data.choices?.[0]?.message?.content || 'Не удалось получить совет'
    
    const progressText = `📊 Прогресс за сегодня:
🔥 Калории: ${total.calories} из ${user.calories_goal}
🥩 Белки: ${total.protein.toFixed(0)}г из ${user.protein_goal}г
🍞 Углеводы: ${total.carbs.toFixed(0)}г из ${user.carbs_goal}г
🥑 Жиры: ${total.fat.toFixed(0)}г из ${user.fat_goal}г

Осталось до цели: ${remaining.calories} ккал

---

${advice}`
    
    return progressText
  } catch (error) {
    console.error('Smart advice error:', error)
    return '❌ Ошибка при получении совета. Попробуйте позже.'
  }
}

async function getUser(userId: number) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data
}

function getInitialSetupMessage() {
  return `🍎 Добро пожаловать в AI бота-нутрициолога!

Я ваш персональный помощник в питании. Помогу:
✅ Отслеживать КБЖУ из текста, фото и голоса
✅ Анализировать ваш рацион
✅ Предлагать рецепты под ваши цели
✅ Составлять план питания
✅ Отправлять ежедневные отчеты

Для персонализированных рекомендаций расскажите о себе:

📏 Рост (в см)
⚖️ Текущий вес (в кг)
🎯 Цель (сбросить/набрать/поддержать вес)
📊 На сколько кг (если худеете/набираете)
🏋️ Уровень активности (зал 3-5 раз/неделя, тренировки 1-2 раза, малоподвижный)
👤 Возраст (опционально)

Пример:
"Мне 30 лет, рост 180см, вешу 85кг, хочу сбросить 10кг, хожу в зал 4 раза в неделю"

После этого я составлю персональный план рациона и рассчитаю ваши цели по КБЖУ!

⚠️ Важно: Вся аналитика примерная!
Точный расчет КБЖУ возможен только при указании точных граммовок продуктов.

Расскажите о себе одним сообщением:`
}

function getUserParamsText(user: any) {
  const goalText = user.goal === 'lose' ? 'Сбросить' : user.goal === 'gain' ? 'Набрать' : 'Поддержать'
  const activityText = user.activity === 'high' ? 'Высокая (зал)' : 
                      user.activity === 'medium' ? 'Средняя' : 'Низкая'
  
  return `⚙️ Ваши параметры:

📏 Рост: ${user.height || 'не указан'} см
⚖️ Вес: ${user.weight || 'не указан'} кг
🎯 Цель: ${goalText} ${user.target_weight ? Math.abs(user.target_weight - user.weight) : ''} кг
🏋️ Активность: ${activityText}

📊 Текущие цели на день:
🔥 Калории: ${user.calories_goal}
🥩 Белки: ${user.protein_goal}г
🍞 Углеводы: ${user.carbs_goal}г
🥑 Жиры: ${user.fat_goal}г

💡 Чтобы изменить параметры, просто напишите новые данные одним сообщением.

⚠️ Помните: аналитика примерная!
Для точного расчета указывайте граммовки продуктов.`
}

function getWelcomeMessage() {
  return `🍎 Добро пожаловать в AI бота-нутрициолога!

Я ваш персональный помощник по питанию с искусственным интеллектом!

🎯 ЧТО Я УМЕЮ:

📊 Анализирую еду:
• Текст: "Я ел гречку с курицей"
• Фото: отправьте фото блюда
• Голос: запишите что ели
→ Сразу даю КБЖУ и советы

🥘 Помогаю с питанием:
• "Что поесть?" → предложу 2-3 варианта под ваши цели
• Рассчитываю персональные нормы КБЖУ
• Составляю план рациона на день
• Предупреждаю о переедании/недоедании

📈 Отслеживаю прогресс:
• Статистика за день (📊 кнопка)
• Ежедневные отчеты в 21:00
• Напоминания о приемах пищи

⌚ Интеграция Apple Watch:
• Синхронизация веса, шагов, сна
• Автокорректировка целей по активности
• Учет сожженных калорий

⚙️ Настройки:
• Укажите параметры (рост, вес, цель)
• Я рассчитаю вашу норму калорий
• Посмотреть параметры: кнопка ⚙️

💡 КАК ПОЛЬЗОВАТЬСЯ:

1️⃣ Расскажите о себе один раз:
"Я 180см, вешу 80кг, хочу сбросить 10кг, хожу в зал"

2️⃣ Записывайте еду любым способом:
"Позавтракал овсянкой и яйцами"
[фото еды]
[голосовое сообщение]

3️⃣ Спрашивайте совет:
"Что мне поесть?"
"Посоветуй рецепт"

4️⃣ Используйте кнопки внизу для быстрого доступа

⚠️ Важно: Аналитика примерная!
Точный КБЖУ только при указании граммовок.

Готовы начать? Расскажите о себе! 🚀`
}

// ⌚ Функции для работы с Apple Watch / Apple Health

async function syncHealthData(userId: number, field: string, value: number) {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    // Проверяем есть ли запись за сегодня
    const { data: existing } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
    if (existing) {
      // Обновляем существующую запись
      await supabase
        .from('health_data')
        .update({ [field]: value })
        .eq('user_id', userId)
        .eq('date', today)
    } else {
      // Создаем новую запись
      await supabase
        .from('health_data')
        .insert({
          user_id: userId,
          date: today,
          [field]: value
        })
    }
  } catch (error) {
    console.error('Sync health data error:', error)
  }
}

async function getHealthData(userId: number) {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    const { data } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
    return data
  } catch (error) {
    return null
  }
}

function calculateAdjustedCalories(baseCalories: number, healthData: any): number {
  let adjusted = baseCalories
  
  // Добавляем калории за высокую активность (шаги)
  if (healthData?.steps && healthData.steps >= 15000) {
    adjusted += 300
  } else if (healthData?.steps && healthData.steps >= 12000) {
    adjusted += 200
  }
  
  // Добавляем калории за недосып (стресс организма)
  if (healthData?.sleep_hours && healthData.sleep_hours < 6) {
    adjusted += 200
  }
  
  // Добавляем сожженные калории с тренировок
  if (healthData?.active_calories) {
    adjusted += healthData.active_calories
  }
  
  return adjusted
}
