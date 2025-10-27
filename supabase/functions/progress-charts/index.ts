// Progress Charts - Визуализация прогресса с графиками
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

/**
 * Отправить фото в Telegram
 */
async function sendPhoto(chatId: number, photoUrl: string, caption?: string, replyMarkup?: any) {
  const payload: any = {
    chat_id: chatId,
    photo: photoUrl,
    parse_mode: 'Markdown'
  }

  if (caption) {
    payload.caption = caption
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }

  try {
    const response = await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('Telegram API error:', result)
    }

    return result
  } catch (error) {
    console.error('Error sending photo:', error)
    throw error
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

    return await response.json()
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}

/**
 * Получить данные для графика калорий (последние 30 дней)
 */
async function getCaloriesChartData(userId: number, days: number = 30) {
  const today = new Date()
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - days)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = today.toISOString().split('T')[0]

  // Получаем все логи за период
  const { data: logs } = await supabase
    .from('food_logs')
    .select('calories, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', `${startDateStr}T00:00:00`)
    .lte('logged_at', `${endDateStr}T23:59:59`)
    .order('logged_at', { ascending: true })

  // Получаем план пользователя
  const { data: plan } = await supabase
    .from('nutrition_plans')
    .select('calories')
    .eq('user_id', userId)
    .single()

  if (!logs || logs.length === 0) {
    return null
  }

  // Группируем по дням
  const dayStats: Record<string, number> = {}
  logs.forEach((log: any) => {
    const day = log.logged_at.split('T')[0]
    dayStats[day] = (dayStats[day] || 0) + (log.calories || 0)
  })

  // Создаем массивы для графика
  const labels: string[] = []
  const data: number[] = []

  // Заполняем все дни (включая дни без логов)
  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - (days - 1 - i))
    const dateStr = date.toISOString().split('T')[0]
    const dayMonth = new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

    labels.push(dayMonth)
    data.push(dayStats[dateStr] || 0)
  }

  return {
    labels,
    data,
    targetCalories: plan?.calories || 2000
  }
}

/**
 * Получить данные для графика белка (последние 30 дней)
 */
async function getProteinChartData(userId: number, days: number = 30) {
  const today = new Date()
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - days)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = today.toISOString().split('T')[0]

  const { data: logs } = await supabase
    .from('food_logs')
    .select('protein, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', `${startDateStr}T00:00:00`)
    .lte('logged_at', `${endDateStr}T23:59:59`)
    .order('logged_at', { ascending: true })

  const { data: plan } = await supabase
    .from('nutrition_plans')
    .select('protein')
    .eq('user_id', userId)
    .single()

  if (!logs || logs.length === 0) {
    return null
  }

  const dayStats: Record<string, number> = {}
  logs.forEach((log: any) => {
    const day = log.logged_at.split('T')[0]
    dayStats[day] = (dayStats[day] || 0) + (log.protein || 0)
  })

  const labels: string[] = []
  const data: number[] = []

  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - (days - 1 - i))
    const dateStr = date.toISOString().split('T')[0]
    const dayMonth = new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

    labels.push(dayMonth)
    data.push(dayStats[dateStr] || 0)
  }

  return {
    labels,
    data,
    targetProtein: plan?.protein || 150
  }
}

/**
 * Получить данные для графика веса (если есть логи веса)
 */
async function getWeightChartData(userId: number, days: number = 90) {
  const today = new Date()
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - days)

  const startDateStr = startDate.toISOString().split('T')[0]

  // Проверяем есть ли у нас таблица weight_logs
  const { data: weights } = await supabase
    .from('weight_logs')
    .select('weight, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', `${startDateStr}T00:00:00`)
    .order('logged_at', { ascending: true })

  if (!weights || weights.length === 0) {
    return null
  }

  const labels = weights.map((w: any) =>
    new Date(w.logged_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  )
  const data = weights.map((w: any) => w.weight)

  return { labels, data }
}

/**
 * Генерировать URL графика через QuickChart API
 */
function generateChartUrl(config: {
  type: 'calories' | 'protein' | 'weight' | 'macros',
  labels: string[],
  data: number[],
  targetValue?: number,
  secondaryData?: number[]
}): string {
  const { type, labels, data, targetValue, secondaryData } = config

  let chartConfig: any = {
    type: 'line',
    data: {
      labels: labels,
      datasets: []
    },
    options: {
      title: {
        display: true,
        text: type === 'calories' ? 'Калории по дням' :
              type === 'protein' ? 'Белок по дням' :
              type === 'weight' ? 'Вес по дням' : 'Макронутриенты',
        fontSize: 18,
        fontColor: '#333'
      },
      scales: {
        yAxes: [{
          ticks: {
            beginAtZero: true,
            fontSize: 12
          }
        }],
        xAxes: [{
          ticks: {
            fontSize: 10,
            maxRotation: 45,
            minRotation: 45
          }
        }]
      },
      legend: {
        display: true,
        position: 'bottom'
      }
    }
  }

  // Основной датасет
  if (type === 'calories') {
    chartConfig.data.datasets.push({
      label: 'Калории',
      data: data,
      borderColor: 'rgb(255, 99, 132)',
      backgroundColor: 'rgba(255, 99, 132, 0.1)',
      fill: true,
      tension: 0.4
    })

    // Целевая линия
    if (targetValue) {
      chartConfig.data.datasets.push({
        label: 'Цель',
        data: new Array(labels.length).fill(targetValue),
        borderColor: 'rgb(54, 162, 235)',
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      })
    }
  } else if (type === 'protein') {
    chartConfig.data.datasets.push({
      label: 'Белок (г)',
      data: data,
      borderColor: 'rgb(75, 192, 192)',
      backgroundColor: 'rgba(75, 192, 192, 0.1)',
      fill: true,
      tension: 0.4
    })

    if (targetValue) {
      chartConfig.data.datasets.push({
        label: 'Цель',
        data: new Array(labels.length).fill(targetValue),
        borderColor: 'rgb(54, 162, 235)',
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      })
    }
  } else if (type === 'weight') {
    chartConfig.data.datasets.push({
      label: 'Вес (кг)',
      data: data,
      borderColor: 'rgb(153, 102, 255)',
      backgroundColor: 'rgba(153, 102, 255, 0.1)',
      fill: true,
      tension: 0.4
    })
  }

  const chartJson = encodeURIComponent(JSON.stringify(chartConfig))
  return `https://quickchart.io/chart?c=${chartJson}&width=800&height=400&backgroundColor=white`
}

/**
 * Главная функция - генерация и отправка графиков
 */
serve(async (req) => {
  try {
    const { userId, chatId, chartType, days } = await req.json()

    if (!userId || !chatId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or chatId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📊 Generating chart for user ${userId}, type: ${chartType}`)

    // Получаем контекст пользователя
    const { data: context } = await supabase
      .rpc('get_user_full_context_by_id', { p_user_id: userId })

    if (!context || !context.profile) {
      await sendMessage(chatId, '❌ Не найден профиль пользователя')
      return new Response(
        JSON.stringify({ success: false, error: 'Profile not found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const daysCount = days || 30

    // Генерируем разные типы графиков
    if (chartType === 'calories' || !chartType) {
      const caloriesData = await getCaloriesChartData(userId, daysCount)

      if (!caloriesData) {
        await sendMessage(
          chatId,
          '📊 Недостаточно данных для графика калорий.\n\nНачни логировать еду каждый день!',
          {
            inline_keyboard: [
              [{ text: "🍽 Записать еду", callback_data: "quick_log_food" }]
            ]
          }
        )
      } else {
        const chartUrl = generateChartUrl({
          type: 'calories',
          labels: caloriesData.labels,
          data: caloriesData.data,
          targetValue: caloriesData.targetCalories
        })

        const avgCalories = Math.round(
          caloriesData.data.reduce((a, b) => a + b, 0) / caloriesData.data.filter(d => d > 0).length
        )

        const caption = `📊 **График калорий** (${daysCount} дней)\n\n` +
          `• Среднее: **${avgCalories}** ккал/день\n` +
          `• Цель: **${caloriesData.targetCalories}** ккал/день\n` +
          `• Отклонение: **${avgCalories > caloriesData.targetCalories ? '+' : ''}${avgCalories - caloriesData.targetCalories}** ккал`

        await sendPhoto(chatId, chartUrl, caption, {
          inline_keyboard: [
            [
              { text: "📈 Белок", callback_data: "chart_protein" },
              { text: "⚖️ Вес", callback_data: "chart_weight" }
            ],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        })
      }
    } else if (chartType === 'protein') {
      const proteinData = await getProteinChartData(userId, daysCount)

      if (!proteinData) {
        await sendMessage(chatId, '📊 Недостаточно данных для графика белка.')
      } else {
        const chartUrl = generateChartUrl({
          type: 'protein',
          labels: proteinData.labels,
          data: proteinData.data,
          targetValue: proteinData.targetProtein
        })

        const avgProtein = Math.round(
          proteinData.data.reduce((a, b) => a + b, 0) / proteinData.data.filter(d => d > 0).length
        )

        const caption = `📊 **График белка** (${daysCount} дней)\n\n` +
          `• Среднее: **${avgProtein}г**/день\n` +
          `• Цель: **${proteinData.targetProtein}г**/день\n` +
          `• Отклонение: **${avgProtein > proteinData.targetProtein ? '+' : ''}${avgProtein - proteinData.targetProtein}г**`

        await sendPhoto(chatId, chartUrl, caption, {
          inline_keyboard: [
            [
              { text: "🔥 Калории", callback_data: "chart_calories" },
              { text: "⚖️ Вес", callback_data: "chart_weight" }
            ],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        })
      }
    } else if (chartType === 'weight') {
      const weightData = await getWeightChartData(userId, 90)

      if (!weightData) {
        await sendMessage(
          chatId,
          '📊 Нет данных о весе.\n\n💡 Начни отслеживать вес через команду /weight',
          {
            inline_keyboard: [
              [{ text: "⚖️ Записать вес", callback_data: "log_weight" }]
            ]
          }
        )
      } else {
        const chartUrl = generateChartUrl({
          type: 'weight',
          labels: weightData.labels,
          data: weightData.data
        })

        const startWeight = weightData.data[0]
        const currentWeight = weightData.data[weightData.data.length - 1]
        const change = currentWeight - startWeight

        const caption = `📊 **График веса** (90 дней)\n\n` +
          `• Начало: **${startWeight}** кг\n` +
          `• Сейчас: **${currentWeight}** кг\n` +
          `• Изменение: **${change > 0 ? '+' : ''}${change.toFixed(1)}** кг`

        await sendPhoto(chatId, chartUrl, caption, {
          inline_keyboard: [
            [
              { text: "🔥 Калории", callback_data: "chart_calories" },
              { text: "📈 Белок", callback_data: "chart_protein" }
            ],
            [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
          ]
        })
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Progress charts error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
