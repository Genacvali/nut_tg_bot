// ============================================
// ОТПРАВКА БЛАГОДАРСТВЕННЫХ СООБЩЕНИЙ
// ============================================
// Отправляет сообщения благодарности ранним пользователям
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendMessageResponse {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

// Отправка сообщения в Telegram
async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  message: string
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to send message to ${chatId}:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Получаем credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting to send thank you messages...");

    // Получаем список подписок с unlimited статусом
    const { data: subscriptions, error: subsError } = await supabase
      .from("user_subscriptions")
      .select("user_id")
      .eq("is_unlimited", true)
      .eq("status", "active");

    if (subsError) {
      throw new Error(`Failed to fetch subscriptions: ${subsError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          failed: 0,
          errors: [],
          message: "No users found with unlimited subscription",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userIds = subscriptions.map(s => s.user_id);

    // Получаем данные пользователей
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, telegram_id, username, first_name")
      .in("id", userIds);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          failed: 0,
          errors: [],
          message: "No users found with unlimited subscription",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Found ${users.length} users with unlimited subscription`);

    // Благодарственное сообщение
    const thankYouMessage = `🎉 **Спасибо, что был с нами с самого начала!**

Привет! Я C.I.D., и я хочу сказать тебе огромное спасибо! 🙏

Ты был одним из **первых пользователей**, кто тестировал меня, давал обратную связь и помогал становиться лучше.

🎁 **В знак благодарности:**
Я дарю тебе **безлимитную подписку навсегда**!

✨ Никаких платежей, никаких ограничений.
Пользуйся всеми функциями бота **абсолютно бесплатно**.

💝 Твоя поддержка бесценна!
Спасибо, что веришь в этот проект и помогаешь ему расти.

🚀 Продолжай достигать своих целей в питании!
Я всегда рядом, чтобы помочь.

С благодарностью,
Команда C.I.D. 💙`;

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Отправляем сообщения с задержкой чтобы не словить rate limit
    for (const user of users) {
      try {
        const success = await sendTelegramMessage(
          botToken,
          user.telegram_id,
          thankYouMessage
        );

        if (success) {
          sent++;
          console.log(`✅ Message sent to ${user.telegram_id} (${user.first_name})`);
        } else {
          failed++;
          errors.push(`Failed to send to ${user.telegram_id} (${user.first_name})`);
        }

        // Задержка 100ms между сообщениями
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        const errorMsg = `Error sending to ${user.telegram_id}: ${error.message}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    console.log(`✅ Finished. Sent: ${sent}, Failed: ${failed}`);

    const result: SendMessageResponse = {
      success: true,
      sent,
      failed,
      errors,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-thank-you-messages:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

