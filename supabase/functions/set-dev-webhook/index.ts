/**
 * Edge Function для установки webhook админского бота
 * 
 * Вызовите эту функцию один раз после деплоя
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const ADMIN_BOT_TOKEN = Deno.env.get('ADMIN_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // URL вашей Edge Function для webhook
    const webhookUrl = `${SUPABASE_URL}/functions/v1/admin-bot`

    console.log('Setting admin webhook to:', webhookUrl)

    // Устанавливаем webhook
    const response = await fetch(
      `https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query']
        })
      }
    )

    const data = await response.json()

    console.log('Admin webhook response:', data)

    return new Response(
      JSON.stringify({
        success: true,
        webhook_url: webhookUrl,
        telegram_response: data
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Error setting admin webhook:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

