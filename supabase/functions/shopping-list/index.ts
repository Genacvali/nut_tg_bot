// Shopping List - Автоматический список покупок на основе плана питания
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
 * Генерировать список покупок на основе плана питания с помощью AI
 */
async function generateShoppingList(userContext: any, days: number = 7): Promise<string> {
  const profile = userContext.profile
  const plan = userContext.plan

  const prompt = `Ты - AI помощник по составлению списков покупок. Создай ПРАКТИЧНЫЙ список покупок на ${days} дней.

**ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:**
- Цель: ${profile.goal === 'lose' ? 'похудение' : profile.goal === 'gain' ? 'набор массы' : 'поддержание веса'}
- Пол: ${profile.gender === 'male' ? 'мужской' : 'женский'}
- Возраст: ${profile.age} лет
- Вес: ${profile.current_weight} кг
- Активность: ${profile.activity_level}

**ПЛАН КБЖУ НА ДЕНЬ:**
- Калории: ${plan.calories} ккал
- Белок: ${plan.protein}г
- Жиры: ${plan.fats}г
- Углеводы: ${plan.carbs}г

**ЗАДАНИЕ:**
Составь список покупок с конкретными продуктами и граммовками на ${days} дней.

**ВАЖНЫЕ ПРАВИЛА:**
1. Учитывай цель пользователя (похудение/набор/поддержание)
2. Включи разнообразные продукты для сбалансированного питания
3. Укажи конкретные граммовки/количество
4. Группируй по категориям
5. Белковые продукты в приоритете для цели
6. Добавь базовые специи и продукты долгого хранения

**ФОРМАТ ОТВЕТА:**

🥩 **Белковые продукты:**
• Куриная грудка - 2 кг
• Яйца - 20 шт
• Творог 5% - 1 кг
• (и т.д.)

🌾 **Крупы и злаки:**
• Рис бурый - 500г
• Овсянка - 500г
• (и т.д.)

🥦 **Овощи:**
• Брокколи - 500г
• Огурцы - 1 кг
• (и т.д.)

🍎 **Фрукты:**
• Бананы - 7 шт
• Яблоки - 1 кг
• (и т.д.)

🥛 **Молочные продукты:**
• Молоко 2.5% - 2л
• Йогурт натуральный - 500г
• (и т.д.)

🥜 **Орехи и семена:**
• Миндаль - 200г
• (и т.д.)

🧂 **Специи и прочее:**
• Соль, перец
• Оливковое масло - 200мл
• (и т.д.)

**СТИЛЬ:**
- Конкретные количества на ${days} дней
- Реалистичные порции
- Доступные продукты
- Учитывай что продукты должны храниться ${days} дней`

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
            content: 'Ты - AI диетолог. Составляешь практичные списки покупок на основе плана питания.'
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
    console.error('Error generating shopping list:', error)
    throw error
  }
}

/**
 * Генерировать упрощенный список покупок (fallback без AI)
 */
function generateBasicShoppingList(plan: any, days: number = 7): string {
  const dailyProtein = plan.protein
  const dailyCarbs = plan.carbs
  const dailyFats = plan.fats

  // Примерное распределение на продукты
  const chickenBreast = Math.round((dailyProtein * 0.4 * days) / 0.23) // 23% белка в курице
  const eggs = Math.ceil((dailyProtein * 0.2 * days) / 6) // ~6г белка на яйцо
  const cottage = Math.round((dailyProtein * 0.2 * days) / 0.16) // 16% белка в твороге

  const rice = Math.round((dailyCarbs * 0.3 * days) / 0.28) // 28% углеводов в рисе
  const oats = Math.round((dailyCarbs * 0.2 * days) / 0.66) // 66% углеводов в овсянке
  const bread = Math.round((dailyCarbs * 0.15 * days) / 0.49) // 49% углеводов в хлебе

  const nuts = Math.round((dailyFats * 0.2 * days) / 0.49) // 49% жиров в орехах
  const oil = Math.round((dailyFats * 0.2 * days) / 0.99) // 99% жиров в масле

  const vegetables = Math.round(300 * days) // 300г овощей в день
  const fruits = Math.round(200 * days) // 200г фруктов в день

  return `🛒 **Список покупок на ${days} дней**

🥩 **Белковые продукты:**
• Куриная грудка - ${Math.round(chickenBreast / 1000)}кг (${chickenBreast}г)
• Яйца - ${eggs} шт
• Творог 5% - ${Math.round(cottage / 1000)}кг

🌾 **Крупы и злаки:**
• Рис - ${Math.round(rice / 100) * 100}г
• Овсянка - ${Math.round(oats / 100) * 100}г
• Хлеб цельнозерновой - ${Math.round(bread / 100) * 100}г

🥦 **Овощи (${Math.round(vegetables / 1000)}кг):**
• Брокколи - 500г
• Огурцы - 500г
• Помидоры - 500г
• Перец болгарский - 300г
• Листовой салат - 200г

🍎 **Фрукты (${Math.round(fruits / 1000)}кг):**
• Бананы - ${Math.ceil(days / 2)} шт
• Яблоки - ${Math.ceil(days / 2)} шт
• Ягоды замороженные - 300г

🥜 **Жиры:**
• Миндаль/орехи - ${Math.round(nuts)}г
• Масло оливковое - ${Math.round(oil)}мл
• Авокадо - ${Math.ceil(days / 3)} шт

🥛 **Молочные:**
• Молоко 2.5% - ${Math.round((days * 200) / 1000)}л
• Йогурт натуральный - 500г

🧂 **Специи и прочее:**
• Соль, перец, специи
• Чеснок, лук

💡 Список рассчитан на основе твоего плана КБЖУ. Корректируй порции по своему вкусу!`
}

/**
 * Главная функция
 */
serve(async (req) => {
  try {
    const { userId, chatId, days } = await req.json()

    if (!userId || !chatId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or chatId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const daysCount = days || 7

    console.log(`🛒 Generating shopping list for user ${userId}, days: ${daysCount}`)

    // Получаем контекст пользователя
    const { data: context } = await supabase
      .rpc('get_user_full_context_by_id', { p_user_id: userId })

    if (!context || !context.profile || !context.plan) {
      await sendMessage(
        chatId,
        '❌ Не найден профиль или план питания.\n\nЗаполни профиль через /start'
      )
      return new Response(
        JSON.stringify({ success: false, error: 'Profile not found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await sendMessage(chatId, `⏳ Составляю список покупок на ${daysCount} дней...`)

    let shoppingList: string

    try {
      // Пробуем сгенерировать с AI
      shoppingList = await generateShoppingList(context, daysCount)
    } catch (error) {
      console.error('Error generating AI shopping list, using fallback:', error)
      // Fallback - используем базовый список
      shoppingList = generateBasicShoppingList(context.plan, daysCount)
    }

    const header = `🛒 **Список покупок**\n📅 На ${daysCount} дней\n\n`
    const footer = `\n\n💡 **Советы:**\n` +
      `• Храни крупы в сухом месте\n` +
      `• Овощи и фрукты - в холодильнике\n` +
      `• Замороженные продукты - отличная альтернатива свежим\n` +
      `• Готовь курицу порциями и храни в контейнерах`

    const fullMessage = header + shoppingList + footer

    await sendMessage(chatId, fullMessage, {
      inline_keyboard: [
        [
          { text: "📅 На 3 дня", callback_data: "shopping_list_3" },
          { text: "📅 На 7 дней", callback_data: "shopping_list_7" }
        ],
        [{ text: "📅 На 14 дней", callback_data: "shopping_list_14" }],
        [{ text: "🏠 Главное меню", callback_data: "main_menu" }]
      ]
    })

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Shopping list error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
