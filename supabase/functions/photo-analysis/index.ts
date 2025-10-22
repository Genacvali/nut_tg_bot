import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

serve(async (req) => {
  try {
    const { photo_url, user_id } = await req.json()
    
    if (!photo_url || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing photo_url or user_id' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400
      })
    }
    
    const analysis = await analyzePhoto(photo_url)
    
    if (analysis.error) {
      return new Response(JSON.stringify(analysis), {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      })
    }
    
    await supabase.from('meals').insert({
      user_id: user_id,
      meal_name: analysis.name,
      calories: analysis.calories,
      protein: analysis.protein,
      carbs: analysis.carbs,
      fat: analysis.fat
    })
    
    return new Response(JSON.stringify(analysis), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

async function analyzePhoto(photoUrl: string) {
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
                image_url: { url: photoUrl }
              }
            ]
          }
        ],
        max_tokens: 300
      })
    })
    
    const data = await response.json()
    
    if (!data.choices || !data.choices[0]) {
      return { error: 'Failed to analyze photo' }
    }
    
    const content = data.choices[0].message.content
    return JSON.parse(content)
  } catch (error) {
    console.error('Analysis error:', error)
    return { error: error.message }
  }
}
