import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

serve(async (req) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('user_id, calories_goal, protein_goal, carbs_goal, fat_goal')
    
    if (!users || users.length === 0) {
      return new Response('No users found', { status: 200 })
    }
    
    let sent = 0
    for (const user of users) {
      const success = await sendDailyReport(user.user_id, user)
      if (success) sent++
    }
    
    return new Response(`Reports sent to ${sent}/${users.length} users`, { status: 200 })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})

async function sendDailyReport(userId: number, goals: any) {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
    
    if (!meals || meals.length === 0) {
      return false
    }
    
    const total = meals.reduce((acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + meal.protein,
      carbs: acc.carbs + meal.carbs,
      fat: acc.fat + meal.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
    
    const advice = generateAdvice(total, goals)
    
    const report = `📊 Ежедневный отчет за ${today}:

🔥 Калории: ${total.calories} / ${goals.calories_goal}
🥩 Белки: ${total.protein.toFixed(1)}г / ${goals.protein_goal}г
🍞 Углеводы: ${total.carbs.toFixed(1)}г / ${goals.carbs_goal}г
🥑 Жиры: ${total.fat.toFixed(1)}г / ${goals.fat_goal}г

${advice}

📝 Всего приемов пищи: ${meals.length}`
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text: report })
    })
    
    return true
  } catch (error) {
    console.error(`Error sending report to user ${userId}:`, error)
    return false
  }
}

function generateAdvice(total: any, goals: any) {
  const advice = []
  const motivation = []
  
  const calDiff = total.calories - goals.calories_goal
  const calPercent = Math.abs(calDiff) / goals.calories_goal * 100
  
  // Анализ калорий с дружеским тоном
  if (calDiff > 100) {
    advice.push(`⚠️ Переедание на ${calDiff} ккал`)
    if (calDiff < 300) {
      motivation.push(`Но это небольшой перебор! Завтра легко компенсируем 💪`)
    } else {
      motivation.push(`Не переживай, бывает! Главное — вернуться к плану завтра 🎯`)
    }
  } else if (calDiff < -200) {
    advice.push(`⚠️ Недоедание на ${Math.abs(calDiff)} ккал`)
    motivation.push(`Не забывай кушать! Организму нужна энергия ⚡`)
  } else {
    motivation.push(`🎉 Отлично! Ты точно попал в цель по калориям!`)
  }
  
  // Анализ белка
  const protDiff = total.protein - goals.protein_goal
  if (protDiff < -20) {
    advice.push(`🥩 Мало белка: ${total.protein.toFixed(1)}г из ${goals.protein_goal}г`)
    motivation.push(`Завтра добавь курицу, творог или яйца — мышцам нужен белок! 💪`)
  } else if (protDiff >= -10 && protDiff <= 10) {
    motivation.push(`🥩 Белка идеально! Мышцы скажут спасибо 👊`)
  }
  
  // Анализ углеводов
  const carbsDiff = total.carbs - goals.carbs_goal
  if (carbsDiff > 50) {
    advice.push(`🍞 Много углеводов: ${total.carbs.toFixed(1)}г`)
    motivation.push(`Попробуй завтра больше овощей вместо каш 🥗`)
  }
  
  // Анализ жиров
  const fatDiff = total.fat - goals.fat_goal
  if (fatDiff > 20) {
    advice.push(`🥑 Много жиров: ${total.fat.toFixed(1)}г`)
  } else if (fatDiff >= -5 && fatDiff <= 5) {
    motivation.push(`🥑 Жиров в норме! Отлично для гормонов 🎯`)
  }
  
  // Общая оценка дня
  let summary = ''
  if (calPercent < 5 && Math.abs(protDiff) < 15) {
    summary = `\n\n⭐⭐⭐ ИДЕАЛЬНЫЙ ДЕНЬ! Ты молодец! 🎊`
  } else if (calPercent < 10) {
    summary = `\n\n👍 Хороший день! Продолжай в том же духе!`
  } else {
    summary = `\n\n💪 Завтра будет лучше! Я верю в тебя!`
  }
  
  return (advice.length > 0 ? advice.join('\n') + '\n\n' : '') + 
         (motivation.length > 0 ? motivation.join('\n') : '') + 
         summary
}
