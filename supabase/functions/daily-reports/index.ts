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
  
  const calDiff = total.calories - goals.calories_goal
  if (calDiff > 100) {
    advice.push(`⚠️ Переедание на ${calDiff} ккал`)
  } else if (calDiff < -200) {
    advice.push(`⚠️ Недоедание на ${Math.abs(calDiff)} ккал`)
  }
  
  const protDiff = total.protein - goals.protein_goal
  if (protDiff < -20) {
    advice.push(`🥩 Мало белка: ${total.protein.toFixed(1)}г из ${goals.protein_goal}г`)
  }
  
  const carbsDiff = total.carbs - goals.carbs_goal
  if (carbsDiff > 50) {
    advice.push(`🍞 Много углеводов: ${total.carbs.toFixed(1)}г из ${goals.carbs_goal}г`)
  }
  
  const fatDiff = total.fat - goals.fat_goal
  if (fatDiff > 20) {
    advice.push(`🥑 Много жиров: ${total.fat.toFixed(1)}г из ${goals.fat_goal}г`)
  }
  
  return advice.length > 0 ? advice.join('\n') : '✅ Отличный баланс КБЖУ!'
}
