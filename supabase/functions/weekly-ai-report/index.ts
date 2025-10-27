// Weekly AI Report - Еженедельный персонализированный AI-отчет
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

/**
 * Отправить длинное сообщение (разбивает на части если нужно)
 */
async function sendLongMessage(chatId: number, text: string, replyMarkup?: any) {
  const MAX_LENGTH = 4000

  if (text.length <= MAX_LENGTH) {
    return await sendMessage(chatId, text, replyMarkup)
  }

  // Разбиваем на части
  const parts = []
  let currentPart = ''

  const lines = text.split('\n')
  for (const line of lines) {
    if ((currentPart + line + '\n').length > MAX_LENGTH) {
      parts.push(currentPart)
      currentPart = line + '\n'
    } else {
      currentPart += line + '\n'
    }
  }

  if (currentPart) {
    parts.push(currentPart)
  }

  // Отправляем части
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1
    await sendMessage(chatId, parts[i], isLast ? replyMarkup : undefined)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

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
 * Собирает статистику за неделю
 */
async function getWeeklyStats(userId: number) {
  const today = new Date()
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const startDate = weekAgo.toISOString().split('T')[0]
  const endDate = today.toISOString().split('T')[0]

  // Получаем все логи за неделю
  const { data: weekLogs } = await supabase
    .from('food_logs')
    .select('calories, protein, fats, carbs, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', `${startDate}T00:00:00`)
    .lte('logged_at', `${endDate}T23:59:59`)
    .order('logged_at', { ascending: true })

  if (!weekLogs || weekLogs.length === 0) {
    return null
  }

  // Группируем по дням
  const dayStats: any = {}
  weekLogs.forEach((log: any) => {
    const day = log.logged_at.split('T')[0]
    if (!dayStats[day]) {
      dayStats[day] = {
        calories: 0,
        protein: 0,
        fats: 0,
        carbs: 0,
        logs_count: 0
      }
    }
    dayStats[day].calories += log.calories || 0
    dayStats[day].protein += log.protein || 0
    dayStats[day].fats += log.fats || 0
    dayStats[day].carbs += log.carbs || 0
    dayStats[day].logs_count += 1
  })

  const days = Object.keys(dayStats).length
  const totalCalories = weekLogs.reduce((sum: number, log: any) => sum + (log.calories || 0), 0)
  const totalProtein = weekLogs.reduce((sum: number, log: any) => sum + (log.protein || 0), 0)
  const totalFats = weekLogs.reduce((sum: number, log: any) => sum + (log.fats || 0), 0)
  const totalCarbs = weekLogs.reduce((sum: number, log: any) => sum + (log.carbs || 0), 0)

  return {
    days_logged: days,
    total_logs: weekLogs.length,
    avg_calories: Math.round(totalCalories / days),
    avg_protein: Math.round(totalProtein / days),
    avg_fats: Math.round(totalFats / days),
    avg_carbs: Math.round(totalCarbs / days),
    day_stats: dayStats
  }
}

/**
 * Генерирует AI-отчет на основе статистики
 */
async function generateAIReport(weeklyStats: any, userContext: any): Promise<string> {
  const profile = userContext.profile
  const plan = userContext.plan
  const streakInfo = userContext.streak_info

  const prompt = `Ты - AI фитнес-ассистент. Создай персонализированный еженедельный отчет для пользователя.

**КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:**
- Цель: ${profile.goal === 'lose' ? 'похудение' : profile.goal === 'gain' ? 'набор массы' : 'поддержание веса'}
- Возраст: ${profile.age}, пол: ${profile.gender === 'male' ? 'мужской' : 'женский'}
- Целевые калории: ${plan.calories} ккал/день
- Целевой белок: ${plan.protein}г/день
- Текущий streak: ${streakInfo?.current_streak || 0} дней
- Рекорд streak: ${streakInfo?.longest_streak || 0} дней

**СТАТИСТИКА ЗА НЕДЕЛЮ:**
- Дней с логами: ${weeklyStats.days_logged} из 7
- Всего логов: ${weeklyStats.total_logs}
- Средние калории: ${weeklyStats.avg_calories} ккал/день (цель: ${plan.calories})
- Средний белок: ${weeklyStats.avg_protein}г/день (цель: ${plan.protein})
- Средние жиры: ${weeklyStats.avg_fats}г/день
- Средние углеводы: ${weeklyStats.avg_carbs}г/день

**ЗАДАНИЕ:**
Создай структурированный отчет с разделами:

1. **📊 Итоги недели** (2-3 предложения - общая оценка)
2. **🎯 Прогресс по цели** (сравни факт с целью, похвали или укажи на отклонения)
3. **💡 Инсайты** (2-3 наблюдения: паттерны, проблемы, сильные стороны)
4. **📝 Рекомендации** (3-4 конкретных совета на следующую неделю)

**СТИЛЬ:**
- Дружелюбный но профессиональный
- Конкретные цифры
- Мотивирующий но честный
- Используй эмодзи умеренно
- Формат: markdown

Отчет должен быть 300-500 слов.`

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
            content: 'Ты - персональный AI фитнес-коуч. Создаешь детальные еженедельные отчеты с анализом и рекомендациями.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
    })

    const data = await response.json()
    return data.choices[0].message.content.trim()
  } catch (error) {
    console.error('Error generating AI report:', error)
    throw error
  }
}

/**
 * Главная функция
 */
serve(async (req) => {
  try {
    // Запускается каждое воскресенье в 18:00
    const today = new Date()
    const dayOfWeek = today.getDay() // 0 = Sunday
    const hour = today.getHours()

    console.log(`📊 Weekly AI Report check: day=${dayOfWeek}, hour=${hour}`)

    // Получаем всех активных пользователей
    const { data: activeUsers, error } = await supabase
      .from('users')
      .select('id, telegram_id, first_name')
      .not('telegram_id', 'is', null)

    if (error) throw error

    console.log(`Found ${activeUsers.length} users to process`)

    let sentCount = 0
    let skippedCount = 0

    for (const user of activeUsers) {
      try {
        // Получаем контекст пользователя
        const { data: context } = await supabase
          .rpc('get_user_full_context_by_id', { p_user_id: user.id })

        if (!context || !context.profile || !context.plan) {
          skippedCount++
          continue
        }

        // Проверяем подписку
        if (!context.subscription ||
            (context.subscription.status !== 'active' &&
             context.subscription.status !== 'trial')) {
          skippedCount++
          continue
        }

        // Получаем статистику за неделю
        const weeklyStats = await getWeeklyStats(user.id)

        if (!weeklyStats) {
          // Нет данных за неделю - отправляем мотивационное сообщение
          await sendMessage(
            user.telegram_id,
            `📊 **Еженедельный отчет**\n\n` +
            `К сожалению, за прошедшую неделю нет данных для анализа.\n\n` +
            `💡 Начни логировать еду каждый день, и через неделю ты получишь персонализированный AI-отчет с инсайтами и рекомендациями!`,
            {
              inline_keyboard: [
                [{ text: "🍽 Записать еду", callback_data: "quick_log_food" }],
                [{ text: "📊 Дневник", callback_data: "diary" }]
              ]
            }
          )
          sentCount++
          continue
        }

        // Получаем streak info
        const { data: streakInfo } = await supabase
          .rpc('get_user_streak_stats', { p_user_id: user.id })
          .single()

        const userContext = {
          profile: context.profile,
          plan: context.plan,
          streak_info: streakInfo
        }

        // Генерируем AI отчет
        const aiReport = await generateAIReport(weeklyStats, userContext)

        // Формируем финальное сообщение
        const reportHeader = `📊 **Твой еженедельный AI-отчет**\n` +
          `📅 ${new Date(Date.now() - 7*24*60*60*1000).toLocaleDateString('ru-RU')} - ${new Date().toLocaleDateString('ru-RU')}\n\n`

        const reportFooter = `\n\n---\n` +
          `💡 Отчеты генерируются каждое воскресенье на основе твоих данных.\n` +
          `Продолжай логировать еду для точного анализа!`

        const fullReport = reportHeader + aiReport + reportFooter

        // Отправляем отчет
        await sendLongMessage(
          user.telegram_id,
          fullReport,
          {
            inline_keyboard: [
              [{ text: "📊 Дневник", callback_data: "diary" }],
              [{ text: "👤 Профиль", callback_data: "profile" }],
              [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
            ]
          }
        )

        sentCount++
        console.log(`✅ Sent weekly report to user ${user.id}`)

        // Задержка чтобы не спамить API
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (userError) {
        console.error(`Error processing user ${user.id}:`, userError)
        skippedCount++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        checked_users: activeUsers.length,
        sent_reports: sentCount,
        skipped: skippedCount
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Weekly AI report error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
