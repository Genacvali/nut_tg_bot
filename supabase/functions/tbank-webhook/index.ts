// ============================================
// T-BANK WEBHOOK HANDLER
// ============================================
// Обрабатывает уведомления от T-Bank о статусе платежа
// Автоматически активирует подписку при успешной оплате
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Генерация Token для проверки подписи
async function generateToken(params: Record<string, any>, password: string): Promise<string> {
  // Добавляем пароль
  const paramsWithPassword = { ...params, Password: password };
  
  // Удаляем Token из параметров (он не участвует в проверке)
  delete paramsWithPassword.Token;
  
  // Сортируем ключи и создаем строку
  const sortedKeys = Object.keys(paramsWithPassword).sort();
  const values = sortedKeys.map(key => String(paramsWithPassword[key]));
  const concatenated = values.join("");
  
  // Хешируем SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  
  return hashHex;
}

// Проверка подписи webhook
async function verifyWebhookSignature(
  body: Record<string, any>,
  password: string
): Promise<boolean> {
  const receivedToken = body.Token;
  if (!receivedToken) {
    console.error("No Token in webhook body");
    return false;
  }

  const expectedToken = await generateToken(body, password);
  const isValid = receivedToken === expectedToken;
  
  if (!isValid) {
    console.error("Token mismatch!");
    console.error("Received:", receivedToken);
    console.error("Expected:", expectedToken);
  }
  
  return isValid;
}

// Отправка уведомления в Telegram
async function sendTelegramNotification(
  botToken: string,
  userId: number,
  message: string,
  inlineKeyboard?: any
) {
  try {
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const body: any = {
      chat_id: userId,
      text: message,
      parse_mode: "Markdown",
    };

    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram API error:", error);
    }
  } catch (error) {
    console.error("Error sending Telegram notification:", error);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Только POST запросы
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    // Получаем тело webhook
    const webhookBody = await req.json();
    console.log("Received webhook:", JSON.stringify(webhookBody, null, 2));

    // Проверяем наличие необходимых полей
    if (!webhookBody.OrderId || !webhookBody.Status) {
      throw new Error("Invalid webhook payload");
    }

    // Инициализируем Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Получаем credentials
    const password = Deno.env.get("TBANK_PASSWORD");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

    if (!password) {
      throw new Error("T-Bank password not configured");
    }

    // Проверяем подпись
    const isValid = await verifyWebhookSignature(webhookBody, password);
    if (!isValid) {
      console.error("Invalid webhook signature!");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("✅ Webhook signature verified");

    // Извлекаем данные
    const {
      OrderId,
      PaymentId,
      Status,
      ErrorCode,
      Message: errorMessage,
    } = webhookBody;

    // Обновляем статус платежа в БД
    const { data: updateResult, error: updateError } = await supabase.rpc(
      "update_payment_status",
      {
        p_order_id: OrderId,
        p_tbank_payment_id: PaymentId,
        p_status: Status,
        p_error_code: ErrorCode || null,
        p_error_message: errorMessage || null,
        p_webhook_data: webhookBody,
      }
    );

    if (updateError) {
      console.error("Error updating payment status:", updateError);
      throw updateError;
    }

    console.log(`✅ Payment status updated: ${Status}`);

    // Получаем информацию о платеже
    const { data: payment, error: paymentError } = await supabase
      .from("payment_intents")
      .select(`
        *,
        subscription_plans (
          name,
          duration_days
        )
      `)
      .eq("order_id", OrderId)
      .single();

    if (paymentError || !payment) {
      console.error("Payment not found:", OrderId);
      throw new Error("Payment not found");
    }

    // Отправляем уведомление пользователю в зависимости от статуса
    if (botToken) {
      let notificationMessage = "";
      let keyboard = null;

      switch (Status) {
        case "CONFIRMED":
          // Платеж успешен!
          notificationMessage =
            `🎉 **Оплата прошла успешно!**\n\n` +
            `📦 Подписка: ${payment.subscription_plans.name}\n` +
            `💰 Сумма: ${payment.amount_rub}₽\n` +
            `⏰ Срок: ${payment.subscription_plans.duration_days} дней\n\n` +
            `✅ Все функции бота разблокированы!\n` +
            `Приятного пользования! 🚀`;
          
          keyboard = [[{ text: "🏠 Главное меню", callback_data: "main_menu" }]];
          break;

        case "REJECTED":
        case "CANCELLED":
          // Платеж отклонен
          notificationMessage =
            `❌ **Оплата не прошла**\n\n` +
            `Причина: ${errorMessage || "Платеж отклонен"}\n\n` +
            `Попробуй снова или выбери другой способ оплаты.`;
          
          keyboard = [[{ text: "🔄 Попробовать снова", callback_data: "buy_subscription" }]];
          break;

        case "AUTHORIZED":
          // Платеж авторизован, ждем подтверждения
          notificationMessage =
            `⏳ **Платеж авторизован**\n\n` +
            `Сейчас происходит финальная проверка.\n` +
            `Подписка будет активирована автоматически через несколько секунд.`;
          break;

        case "REFUNDED":
          // Возврат средств
          notificationMessage =
            `💰 **Возврат средств**\n\n` +
            `Сумма ${payment.amount_rub}₽ будет возвращена на твою карту\n` +
            `в течение 3-5 рабочих дней.`;
          break;

        default:
          console.log(`Webhook status ${Status} - no notification sent`);
      }

      if (notificationMessage) {
        await sendTelegramNotification(
          botToken,
          payment.user_id,
          notificationMessage,
          keyboard
        );
        console.log(`✅ Notification sent to user ${payment.user_id}`);
      }
    }

    // Возвращаем успех (T-Bank требует 200 OK)
    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in tbank-webhook:", error);

    // Возвращаем 200 OK даже при ошибке (чтобы T-Bank не повторял webhook)
    // Но логируем ошибку для отладки
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 200, // Важно! T-Bank ожидает 200
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

