// Broadcast Message - Массовая рассылка обновлений пользователям
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

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
      return { success: false, error: result.description }
    }

    return { success: true }
  } catch (error) {
    console.error('Error sending message:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Главная функция - массовая рассылка
 */
serve(async (req) => {
  try {
    // Проверяем метод и авторизацию
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Получаем параметры из запроса
    const { message, onlyActiveSubscribers, delayMs, keyboard } = await req.json()

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const delay = delayMs || 100 // Задержка между отправками (по умолчанию 100ms)

    console.log(`📢 Starting broadcast: onlyActive=${onlyActiveSubscribers}, delay=${delay}ms`)

    // Получаем пользователей
    let query = supabase
      .from('users')
      .select('id, telegram_id, first_name')
      .not('telegram_id', 'is', null)

    // Если нужны только активные подписчики
    if (onlyActiveSubscribers) {
      // Получаем пользователей с активной подпиской через RPC
      const { data: activeUsers, error: usersError } = await supabase
        .rpc('get_users_with_active_subscription')

      if (usersError) {
        console.error('Error getting users:', usersError)
        throw usersError
      }

      if (!activeUsers || activeUsers.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            total_users: 0,
            sent: 0,
            failed: 0,
            message: 'No active subscribers found'
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          }
        )
      }

      // Отправляем рассылку активным пользователям
      let sentCount = 0
      let failedCount = 0
      const failedUsers: any[] = []

      for (const user of activeUsers) {
        if (!user.telegram_id) continue

        const result = await sendMessage(
          user.telegram_id,
          message,
          keyboard ? { inline_keyboard: keyboard } : undefined
        )

        if (result.success) {
          sentCount++
          console.log(`✅ Sent to user ${user.id} (${user.first_name})`)
        } else {
          failedCount++
          failedUsers.push({
            user_id: user.id,
            telegram_id: user.telegram_id,
            error: result.error
          })
          console.error(`❌ Failed to send to user ${user.id}: ${result.error}`)
        }

        // Задержка между отправками
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      return new Response(
        JSON.stringify({
          success: true,
          total_users: activeUsers.length,
          sent: sentCount,
          failed: failedCount,
          failed_users: failedUsers
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        }
      )
    } else {
      // Отправляем всем пользователям
      const { data: allUsers, error: usersError } = await query

      if (usersError) throw usersError

      if (!allUsers || allUsers.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            total_users: 0,
            sent: 0,
            failed: 0,
            message: 'No users found'
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          }
        )
      }

      let sentCount = 0
      let failedCount = 0
      const failedUsers: any[] = []

      for (const user of allUsers) {
        const result = await sendMessage(
          user.telegram_id,
          message,
          keyboard ? { inline_keyboard: keyboard } : undefined
        )

        if (result.success) {
          sentCount++
          console.log(`✅ Sent to user ${user.id} (${user.first_name})`)
        } else {
          failedCount++
          failedUsers.push({
            user_id: user.id,
            telegram_id: user.telegram_id,
            error: result.error
          })
          console.error(`❌ Failed to send to user ${user.id}: ${result.error}`)
        }

        // Задержка между отправками
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      return new Response(
        JSON.stringify({
          success: true,
          total_users: allUsers.length,
          sent: sentCount,
          failed: failedCount,
          failed_users: failedUsers
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

  } catch (error) {
    console.error('Broadcast error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
