// Smart Notifications - Умные напоминания с AI контекстом
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

/**
 * Отправить сообщение в Telegram
 */
async function sendMessage(chatId: number, text: string, replyMarkup?: any) {
  const payload: any = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }

  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('Telegram API error:', result)
      // Retry without markdown if parse error
      if (result.description?.includes("can't parse entities")) {
        payload.parse_mode = undefined
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }
    }

    return result
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}

/**
 * Генерация умного напоминания с AI
 */
async function generateSmartReminder(
  userContext: any,
  reminderType: 'morning' | 'lunch' | 'evening' | 'water' | 'streak_risk'
): Promise<string> {

  const profile = userContext.profile
  const plan = userContext.plan
  const todayStats = userContext.today_stats
  const streakInfo = userContext.streak_info

  let prompt = ''

  if (reminderType === 'morning') {
    prompt = `Сгенерируй короткое (2-3 предложения) мотивирующее утреннее напоминание для пользователя фитнес-приложения.

Контекст пользователя:
- Цель: ${profile.goal === 'lose' ? 'похудение' : profile.goal === 'gain' ? 'набор массы' : 'поддержание веса'}
- План калорий на день: ${plan.calories} ккал
- Текущий streak: ${streakInfo?.current_streak || 0} дней

Включи:
1. Приветствие с упоминанием streak (если есть)
2. Краткую рекомендацию для завтрака с примерными калориями
3. Мотивацию

Не используй эмодзи в избытке. Тон - дружелюбный, но профессиональный.`
  }

  else if (reminderType === 'lunch') {
    const remainingCalories = plan.calories - (todayStats?.calories || 0)
    const remainingProtein = plan.protein - (todayStats?.protein || 0)

    prompt = `Сгенерируй короткое (2-3 предложения) напоминание об обеде для пользователя фитнес-приложения.

Контекст:
- Уже съедено сегодня: ${todayStats?.calories || 0} ккал
- Осталось на день: ${remainingCalories} ккал
- Не хватает белка: ${Math.max(0, remainingProtein)}г

Включи:
1. Напоминание о времени обеда
2. Рекомендацию что поесть с учетом оставшихся калорий
3. Упоминание белка если его мало

Не используй эмодзи в избытке.`
  }

  else if (reminderType === 'evening') {
    const remainingCalories = plan.calories - (todayStats?.calories || 0)

    prompt = `Сгенерируй короткое (2-3 предложения) вечернее напоминание для пользователя фитнес-приложения.

Контекст:
- Уже съедено: ${todayStats?.calories || 0} ккал из ${plan.calories} ккал
- Осталось: ${remainingCalories} ккал

Если осталось мало калорий (< 300) - посоветуй легкий ужин.
Если осталось много (> 600) - напомни не пропускать ужин.
Если примерно норма - похвали за баланс.

Не используй эмодзи в избытке.`
  }

  else if (reminderType === 'water') {
    prompt = `Сгенерируй очень короткое (1-2 предложения) напоминание про воду для пользователя фитнес-приложения.

Норма воды: ${plan.water ? Math.round(plan.water * 1000) : 2000}мл в день

Сделай его мотивирующим но кратким. Не используй много эмодзи.`
  }

  else if (reminderType === 'streak_risk') {
    prompt = `Сгенерируй короткое (2-3 предложения) МОТИВИРУЮЩЕЕ напоминание что пользователь рискует потерять streak.

Текущий streak: ${streakInfo?.current_streak || 0} дней
Рекорд: ${streakInfo?.longest_streak || 0} дней

Тон - срочный но не агрессивный. Мотивируй не потерять серию.
Не используй много эмодзи.`
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Ты - ассистент фитнес-приложения. Генерируешь короткие персонализированные напоминания. Пиши на русском, дружелюбно но профессионально.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    })

    const data = await response.json()
    return data.choices[0].message.content.trim()
  } catch (error) {
    console.error('Error generating AI reminder:', error)
    // Fallback messages
    const fallbacks = {
      morning: `☀️ Доброе утро! Не забудь залогировать завтрак. У тебя ${plan.calories} ккал на день.`,
      lunch: `🍽 Время обеда! Осталось ${plan.calories - (todayStats?.calories || 0)} ккал.`,
      evening: `🌙 Время ужина! Сегодня ты съел ${todayStats?.calories || 0} ккал из ${plan.calories} ккал.`,
      water: `💧 Не забывай пить воду! Норма: ${plan.water ? Math.round(plan.water * 1000) : 2000}мл в день.`,
      streak_risk: `🔥 Твой streak ${streakInfo?.current_streak || 0} дней в опасности! Залогируй еду сегодня!`
    }
    return fallbacks[reminderType]
  }
}

/**
 * Главная функция - отправка умных напоминаний
 */
serve(async (req) => {
  try {
    // Cron job вызывает эту функцию каждый час
    const currentHour = new Date().getHours()
    console.log(`⏰ Smart notifications check at ${currentHour}:00`)

    // Получаем пользователей с активной подпиской
    const { data: activeUsers, error } = await supabase
      .from('users')
      .select(`
        id,
        telegram_id,
        first_name,
        current_streak,
        longest_streak,
        last_log_date
      `)
      .not('telegram_id', 'is', null)

    if (error) throw error

    console.log(`Found ${activeUsers.length} users to check`)

    let sentCount = 0

    for (const user of activeUsers) {
      try {
        // Получаем полный контекст пользователя
        const { data: context } = await supabase
          .rpc('get_user_full_context_by_id', { p_user_id: user.id })

        if (!context || !context.profile || !context.plan) {
          continue // Skip users without profile
        }

        // Проверяем подписку
        if (!context.subscription ||
            (context.subscription.status !== 'active' &&
             context.subscription.status !== 'trial')) {
          continue // Skip users without active subscription
        }

        // Получаем статистику за сегодня
        const today = new Date().toISOString().split('T')[0]
        const { data: todayLogs } = await supabase
          .from('food_logs')
          .select('calories, protein, fats, carbs')
          .eq('user_id', user.id)
          .gte('logged_at', `${today}T00:00:00`)

        const todayStats = todayLogs?.reduce((acc, log) => ({
          calories: acc.calories + (log.calories || 0),
          protein: acc.protein + (log.protein || 0),
          fats: acc.fats + (log.fats || 0),
          carbs: acc.carbs + (log.carbs || 0)
        }), { calories: 0, protein: 0, fats: 0, carbs: 0 })

        // Получаем streak info
        const { data: streakInfo } = await supabase
          .rpc('get_user_streak_stats', { p_user_id: user.id })
          .single()

        const userContext = {
          profile: context.profile,
          plan: context.plan,
          today_stats: todayStats,
          streak_info: streakInfo
        }

        let shouldSend = false
        let reminderType: any = null
        let reminderText = ''

        // ЛОГИКА ОТПРАВКИ НАПОМИНАНИЙ

        // 1. STREAK RISK (приоритет!) - отправляем в 20:00 если пользователь не логировал сегодня
        if (currentHour === 20 &&
            user.current_streak > 0 &&
            (!todayLogs || todayLogs.length === 0)) {
          shouldSend = true
          reminderType = 'streak_risk'
          reminderText = await generateSmartReminder(userContext, 'streak_risk')
        }

        // 2. УТРЕННЕЕ НАПОМИНАНИЕ - 8:00
        else if (currentHour === 8) {
          shouldSend = true
          reminderType = 'morning'
          reminderText = await generateSmartReminder(userContext, 'morning')
        }

        // 3. ОБЕД - 13:00 (только если еще не ел)
        else if (currentHour === 13 && (!todayStats || todayStats.calories < 500)) {
          shouldSend = true
          reminderType = 'lunch'
          reminderText = await generateSmartReminder(userContext, 'lunch')
        }

        // 4. УЖИН - 19:00
        else if (currentHour === 19) {
          shouldSend = true
          reminderType = 'evening'
          reminderText = await generateSmartReminder(userContext, 'evening')
        }

        // 5. ВОДА - 12:00, 16:00
        else if (currentHour === 12 || currentHour === 16) {
          shouldSend = true
          reminderType = 'water'
          reminderText = await generateSmartReminder(userContext, 'water')
        }

        // Отправляем напоминание
        if (shouldSend && reminderText) {
          await sendMessage(
            user.telegram_id,
            reminderText,
            {
              inline_keyboard: [
                [{ text: "🍽 Записать еду", callback_data: "quick_log_food" }],
                [{ text: "⚡ Быстрый лог", callback_data: "quick_log" }]
              ]
            }
          )

          sentCount++
          console.log(`✅ Sent ${reminderType} reminder to user ${user.id}`)

          // Небольшая задержка чтобы не спамить Telegram API
          await new Promise(resolve => setTimeout(resolve, 100))
        }

      } catch (userError) {
        console.error(`Error processing user ${user.id}:`, userError)
        // Continue with next user
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        hour: currentHour,
        checked_users: activeUsers.length,
        sent_notifications: sentCount
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Smart notifications error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
