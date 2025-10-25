// ============================================
// T-BANK PAYMENT INITIALIZATION
// ============================================
// Создает платеж в T-Bank и возвращает URL для оплаты
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// T-Bank API URL
const TBANK_API_URL = "https://securepay.tinkoff.ru/v2";

interface PaymentRequest {
  userId: number;
  planId: number;
}

// Генерация Token для T-Bank (SHA-256 подпись)
async function generateToken(params: Record<string, any>, password: string): Promise<string> {
  // Исключаем сложные объекты (Receipt, DATA, Shops и т.д.)
  // Только простые параметры участвуют в подписи!
  const simpleParams: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Пропускаем объекты и массивы
    if (typeof value !== 'object' || value === null) {
      simpleParams[key] = value;
    }
  }
  
  // Добавляем пароль
  const paramsWithPassword = { ...simpleParams, Password: password };
  
  // Сортируем ключи и создаем строку
  const sortedKeys = Object.keys(paramsWithPassword).sort();
  const values = sortedKeys.map(key => String(paramsWithPassword[key]));
  const concatenated = values.join("");
  
  console.log('Token generation params:', sortedKeys);
  console.log('Token string:', concatenated);
  
  // Хешируем SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  
  return hashHex;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Проверяем метод
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    // Получаем данные из запроса
    const { userId, planId }: PaymentRequest = await req.json();

    if (!userId || !planId) {
      throw new Error("Missing userId or planId");
    }

    console.log(`Creating payment for user ${userId}, plan ${planId}`);

    // Инициализируем Supabase клиент
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Получаем T-Bank credentials
    const terminalKey = Deno.env.get("TBANK_TERMINAL_KEY");
    const password = Deno.env.get("TBANK_PASSWORD");
    const botUsername = Deno.env.get("BOT_USERNAME") || "cid_nutrition_bot";

    if (!terminalKey || !password) {
      throw new Error("T-Bank credentials not configured");
    }

    // Получаем информацию о плане
    const { data: plan, error: planError } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", planId)
      .single();

    if (planError || !plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Генерируем уникальный OrderId
    const orderId = `${userId}_${planId}_${Date.now()}`;

    // Создаем платежное намерение в БД
    const { data: paymentIntent, error: piError } = await supabase.rpc(
      "create_payment_intent",
      {
        p_user_id: userId,
        p_plan_id: planId,
        p_order_id: orderId,
      }
    );

    if (piError) {
      console.error("Error creating payment intent:", piError);
      throw new Error(`Failed to create payment intent: ${piError.message}`);
    }

    console.log(`Payment intent created: ${paymentIntent}`);

    // Конвертируем сумму в копейки (T-Bank требует!)
    const amountKopeks = Math.round(plan.price_rub * 100);

    // URLs для редиректа
    // Используем официальные страницы T-Bank с автоматическим редиректом в бот
    const successUrl = `https://securepay.tinkoff.ru/html/payForm/success.html`;
    const failUrl = `https://securepay.tinkoff.ru/html/payForm/fail.html`;

    // Чек для 54-ФЗ (обязательно!)
    const receipt = {
      Email: "support@cid-bot.ru", // Email для отправки чека (можно заменить на email пользователя если есть)
      Taxation: "usn_income", // УСН доход (упрощенная система налогообложения)
      Items: [
        {
          Name: `Подписка C.I.D. (${plan.name === 'monthly' ? '1 месяц' : plan.name === 'quarterly' ? '6 месяцев' : '1 год'})`,
          Price: amountKopeks, // Цена в копейках
          Quantity: 1.00,
          Amount: amountKopeks, // Сумма = Price * Quantity
          Tax: "none", // Без НДС
          PaymentMethod: "full_prepayment", // Полная предоплата
          PaymentObject: "service" // Услуга
        }
      ]
    };

    // URL для webhook уведомлений от T-Bank
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const notificationUrl = `${SUPABASE_URL}/functions/v1/tbank-webhook`;
    
    console.log(`Notification URL: ${notificationUrl}`);

    // Параметры запроса к T-Bank
    const initParams: Record<string, any> = {
      TerminalKey: terminalKey,
      Amount: amountKopeks,
      OrderId: orderId,
      Description: `Подписка C.I.D.: ${plan.name}`,
      Receipt: receipt, // Добавляем чек!
      NotificationURL: notificationUrl, // URL для webhook уведомлений
      SuccessURL: successUrl,
      FailURL: failUrl,
      Language: "ru",
    };

    // Генерируем Token (подпись)
    const token = await generateToken(initParams, password);
    const requestBody = {
      ...initParams,
      Token: token,
    };

    console.log("Calling T-Bank Init API...");
    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    // Отправляем запрос к T-Bank
    const tbankResponse = await fetch(`${TBANK_API_URL}/Init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const tbankData = await tbankResponse.json();
    console.log("T-Bank response:", JSON.stringify(tbankData, null, 2));

    // Проверяем ответ
    if (!tbankData.Success) {
      console.error("T-Bank error:", tbankData);
      
      // Обновляем статус платежа
      await supabase
        .from("payment_intents")
        .update({
          status: "REJECTED",
          error_code: tbankData.ErrorCode,
          error_message: tbankData.Message || tbankData.Details,
          response_data: tbankData,
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);

      throw new Error(
        `T-Bank error: ${tbankData.Message || tbankData.Details || "Unknown error"}`
      );
    }

    // Обновляем payment intent с данными от T-Bank
    const { error: updateError } = await supabase
      .from("payment_intents")
      .update({
        tbank_payment_id: tbankData.PaymentId,
        payment_url: tbankData.PaymentURL,
        success_url: successUrl,
        fail_url: failUrl,
        request_data: requestBody,
        response_data: tbankData,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", orderId);

    if (updateError) {
      console.error("Error updating payment intent:", updateError);
    }

    // Возвращаем URL для оплаты
    return new Response(
      JSON.stringify({
        success: true,
        paymentUrl: tbankData.PaymentURL,
        paymentId: tbankData.PaymentId,
        orderId: orderId,
        amount: plan.price_rub,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in tbank-payment:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

