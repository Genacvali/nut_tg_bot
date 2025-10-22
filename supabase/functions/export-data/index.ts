import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

serve(async (req) => {
  try {
    const { user_id, days = 30 } = await req.json()
    
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400
      })
    }
    
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    const { data: meals, error } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', user_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })
    
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      })
    }
    
    const csv = generateCSV(meals || [])
    
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="nutrition_data_${user_id}.csv"`
      }
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

function generateCSV(meals: any[]) {
  const headers = ['Дата', 'Название', 'Калории', 'Белки', 'Углеводы', 'Жиры']
  const rows = meals.map(meal => [
    meal.created_at.split('T')[0],
    meal.meal_name,
    meal.calories,
    meal.protein,
    meal.carbs,
    meal.fat
  ])
  
  return [headers, ...rows].map(row => row.join(',')).join('\n')
}
