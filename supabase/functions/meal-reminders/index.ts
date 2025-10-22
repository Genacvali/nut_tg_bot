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
      .select('user_id')
    
    if (!users || users.length === 0) {
      return new Response('No users found', { status: 200 })
    }
    
    let sent = 0
    for (const user of users) {
      const success = await sendMealReminder(user.user_id)
      if (success) sent++
    }
    
    return new Response(`Reminders sent to ${sent}/${users.length} users`, { status: 200 })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})

async function sendMealReminder(userId: number) {
  try {
    const today = new Date().toISOString().split('T')[0]
    const currentHour = new Date().getHours()
    
    // Проверяем, был ли прием пищи за последние 4 часа
    const fourHoursAgo = new Date()
    fourHoursAgo.setHours(fourHoursAgo.getHours() - 4)
    
    const { data: recentMeals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', fourHoursAgo.toISOString())
    
    // Если есть недавние приемы пищи, не напоминаем
    if (recentMeals && recentMeals.length > 0) {
      return false
    }
    
    // Проверяем, что сегодня было мало приемов пищи
    const { data: todayMeals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
    
    const mealCount = todayMeals?.length || 0
    
    // Напоминания по времени и количеству приемов
    let reminderText = ''
    
    if (currentHour === 13 && mealCount === 0) {
      reminderText = '🍽️ Время обеда! Не забудьте поесть и записать это 😊'
    } else if (currentHour === 19 && mealCount < 2) {
      reminderText = '🍽️ Время ужина! Сегодня вы еще мало ели. Не забудьте записать прием пищи!'
    } else if (currentHour === 9 && mealCount === 0) {
      reminderText = '🥐 Доброе утро! Не забудьте позавтракать и записать это в дневник!'
    }
    
    if (reminderText) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, text: reminderText })
      })
      return true
    }
    
    return false
  } catch (error) {
    console.error(`Error sending reminder to user ${userId}:`, error)
    return false
  }
}
