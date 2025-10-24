/**
 * Supabase Edge Function для отправки уведомлений по расписанию
 * Вызывается через pg_cron каждые 5 минут
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

/**
 * Отправка сообщения в Telegram
 */
async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: any): Promise<boolean> {
  try {
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
    
    const result = await response.json()
    return result.ok
  } catch (error) {
    console.error('Error sending Telegram message:', error)
    return false
  }
}

/**
 * Получить локальное время пользователя
 */
function getUserLocalTime(timezone: string): Date {
  try {
    const now = new Date()
    const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    return userTime
  } catch (error) {
    console.error('Error getting user local time:', error)
    return new Date()
  }
}

/**
 * Проверить, нужно ли отправить уведомление о еде
 */
async function shouldSendFoodNotification(
  userId: string, 
  settings: any, 
  userLocalTime: Date
): Promise<boolean> {
  const currentHour = userLocalTime.getHours()
  const currentMinute = userLocalTime.getMinutes()
  const currentTimeMinutes = currentHour * 60 + currentMinute
  
  // Парсим время начала и конца
  const [startHour, startMinute] = settings.food_notification_start_time.split(':').map(Number)
  const [endHour, endMinute] = settings.food_notification_end_time.split(':').map(Number)
  const startTimeMinutes = startHour * 60 + startMinute
  const endTimeMinutes = endHour * 60 + endMinute
  
  // Проверяем, находится ли текущее время в диапазоне
  if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
    return false
  }
  
  // Рассчитываем интервал между уведомлениями
  const totalMinutes = endTimeMinutes - startTimeMinutes
  const interval = totalMinutes / settings.food_notification_count
  
  // Рассчитываем, сколько минут прошло с начала
  const minutesSinceStart = currentTimeMinutes - startTimeMinutes
  
  // Проверяем, не отправляли ли уже уведомление в последние 15 минут
  const { data: recentLogs } = await supabase
    .from('notification_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('notification_type', 'food')
    .gte('sent_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .limit(1)
  
  if (recentLogs && recentLogs.length > 0) {
    return false
  }
  
  // Проверяем, попадаем ли мы в одно из запланированных окон (с погрешностью ±5 минут)
  for (let i = 0; i < settings.food_notification_count; i++) {
    const targetTime = i * interval
    if (Math.abs(minutesSinceStart - targetTime) <= 5) {
      return true
    }
  }
  
  return false
}

/**
 * Проверить, нужно ли отправить уведомление о воде
 */
async function shouldSendWaterNotification(
  userId: string,
  settings: any,
  userLocalTime: Date
): Promise<boolean> {
  const currentHour = userLocalTime.getHours()
  const currentMinute = userLocalTime.getMinutes()
  const currentTimeMinutes = currentHour * 60 + currentMinute
  
  // Парсим время начала и конца
  const [startHour, startMinute] = settings.water_notification_start_time.split(':').map(Number)
  const [endHour, endMinute] = settings.water_notification_end_time.split(':').map(Number)
  const startTimeMinutes = startHour * 60 + startMinute
  const endTimeMinutes = endHour * 60 + endMinute
  
  // Проверяем, находится ли текущее время в диапазоне
  if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
    return false
  }
  
  // Проверяем, не отправляли ли уже уведомление в последние N минут
  const checkInterval = settings.water_notification_interval_minutes - 5 // С небольшой погрешностью
  const { data: recentLogs } = await supabase
    .from('notification_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('notification_type', 'water')
    .gte('sent_at', new Date(Date.now() - checkInterval * 60 * 1000).toISOString())
    .limit(1)
  
  if (recentLogs && recentLogs.length > 0) {
    return false
  }
  
  return true
}

/**
 * Сформировать текст уведомления о еде с учетом оставшихся КБЖУ
 */
async function generateFoodNotificationText(userId: string): Promise<string> {
  // Получаем план питания
  const { data: plan } = await supabase
    .from('nutrition_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()
  
  if (!plan) {
    return '🍽 Время поесть! Не забудь записать свой прием пищи.'
  }
  
  // Получаем записи за сегодня
  const today = new Date().toISOString().split('T')[0]
  const { data: todayLogs } = await supabase
    .from('food_logs')
    .select('*')
    .eq('user_id', userId)
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
  
  const percentConsumed = Math.round((consumed.calories / plan.calories) * 100)
  
  let message = `🍽 *Время поесть!*\n\n`
  
  if (percentConsumed < 25) {
    message += `☀️ Отличное начало дня! У тебя впереди весь дневной рацион.\n\n`
  } else if (percentConsumed < 50) {
    message += `👍 Ты на верном пути! Осталось еще много вкусного.\n\n`
  } else if (percentConsumed < 75) {
    message += `💪 Продолжай в том же духе! Ты уже больше половины пути.\n\n`
  } else if (percentConsumed < 100) {
    message += `🎯 Почти у цели! Осталось совсем немного.\n\n`
  } else {
    message += `✅ Ты выполнил свой план! Отличная работа.\n\n`
  }
  
  message += `📊 *Осталось сегодня:*\n`
  message += `🔥 ${remaining.calories} ккал\n`
  message += `🥩 ${remaining.protein}г белка\n`
  message += `🥑 ${remaining.fats}г жиров\n`
  message += `🍞 ${remaining.carbs}г углеводов`
  
  return message
}

/**
 * Сформировать текст уведомления о воде
 */
async function generateWaterNotificationText(userId: string): Promise<string> {
  // Получаем план питания для нормы воды
  const { data: plan } = await supabase
    .from('nutrition_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()
  
  const waterGoal = plan?.water || 2.5
  
  const messages = [
    `💧 *Время выпить воды!*\n\nТвоя норма: ${waterGoal}л в день\n\n💡 Вода помогает ускорить метаболизм и вывести токсины.`,
    `💧 *Не забудь про воду!*\n\nЦель: ${waterGoal}л в день\n\n💡 Достаточное потребление воды улучшает работу мозга.`,
    `💧 *Время гидратации!*\n\nНорма: ${waterGoal}л в день\n\n💡 Вода участвует во всех обменных процессах организма.`,
    `💧 *Попей водички!*\n\nЦель: ${waterGoal}л в день\n\n💡 Даже легкое обезвоживание снижает работоспособность.`
  ]
  
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Обработка уведомлений для всех пользователей
 */
async function processNotifications() {
  console.log('Starting notification processing...')
  
  // Получаем всех пользователей с активными уведомлениями
  const { data: settings, error } = await supabase
    .from('notification_settings')
    .select(`
      *,
      users!inner(telegram_id)
    `)
    .or('food_notifications_enabled.eq.true,water_notifications_enabled.eq.true')
  
  if (error) {
    console.error('Error fetching notification settings:', error)
    return { error: error.message }
  }
  
  if (!settings || settings.length === 0) {
    console.log('No users with enabled notifications')
    return { processed: 0 }
  }
  
  let foodSent = 0
  let waterSent = 0
  
  // Обрабатываем каждого пользователя
  for (const setting of settings) {
    try {
      const userLocalTime = getUserLocalTime(setting.timezone)
      console.log(`Processing user ${setting.user_id}, local time: ${userLocalTime.toISOString()}`)
      
      // Проверяем уведомления о еде
      if (setting.food_notifications_enabled) {
        const shouldSendFood = await shouldSendFoodNotification(
          setting.user_id,
          setting,
          userLocalTime
        )
        
        if (shouldSendFood) {
          const text = await generateFoodNotificationText(setting.user_id)
          const sent = await sendTelegramMessage(
            setting.users.telegram_id,
            text,
            {
              inline_keyboard: [
                [{ text: "📋 Меню рецептов", callback_data: "menu_recipes" }],
                [{ text: "🍽 Записать прием", callback_data: "log_food" }]
              ]
            }
          )
          
          if (sent) {
            // Логируем отправку
            await supabase
              .from('notification_logs')
              .insert({
                user_id: setting.user_id,
                notification_type: 'food',
                sent_at: new Date().toISOString()
              })
            
            foodSent++
            console.log(`Food notification sent to user ${setting.user_id}`)
          }
        }
      }
      
      // Проверяем уведомления о воде
      if (setting.water_notifications_enabled) {
        const shouldSendWater = await shouldSendWaterNotification(
          setting.user_id,
          setting,
          userLocalTime
        )
        
        if (shouldSendWater) {
          const text = await generateWaterNotificationText(setting.user_id)
          const sent = await sendTelegramMessage(
            setting.users.telegram_id,
            text,
            {
              inline_keyboard: [
                [{ text: "🍽 Записать прием", callback_data: "log_food" }]
              ]
            }
          )
          
          if (sent) {
            // Логируем отправку
            await supabase
              .from('notification_logs')
              .insert({
                user_id: setting.user_id,
                notification_type: 'water',
                sent_at: new Date().toISOString()
              })
            
            waterSent++
            console.log(`Water notification sent to user ${setting.user_id}`)
          }
        }
      }
      
    } catch (error) {
      console.error(`Error processing user ${setting.user_id}:`, error)
    }
  }
  
  console.log(`Notification processing complete. Food: ${foodSent}, Water: ${waterSent}`)
  
  return {
    processed: settings.length,
    foodSent,
    waterSent
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
    // Проверяем авторизацию (для безопасности)
    const authHeader = req.headers.get('Authorization')
    const expectedAuth = `Bearer ${SUPABASE_SERVICE_KEY}`
    
    if (authHeader !== expectedAuth) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      )
    }
    
    const result = await processNotifications()
    
    return new Response(
      JSON.stringify(result),
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

