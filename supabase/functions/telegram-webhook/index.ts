// Telegram бот-нутрициолог - LLM-driven версия
// Диалоговый AI с объяснениями и гибкой настройкой плана

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OpenAI } from 'https://esm.sh/openai@4'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

// Простой кеш для планов (живёт в памяти Edge Function)
const plansCache = new Map<number, { plan: any, timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 минут

// FSM состояния
type UserState = 'none' | 'profile_age' | 'profile_sex' | 'profile_height' | 'profile_weight' | 
                 'profile_activity' | 'profile_goal' | 'profile_tz' | 'meal_input' | 'plan_discussion' | 'custom_calories' |
                 'manual_protein' | 'manual_fat' | 'manual_carbs'

// System prompt для LLM
const SYSTEM_PROMPT = `Ты — C.I.D., нутри-коуч. Твоя задача: понимать свободные фразы и возвращать **строгий JSON** c намерением и параметрами.

ВАЖНО: Если запрос неоднозначный (например "хочу больше белка и меньше углей, калории оставь") — ты ДОЛЖЕН уточнить:
- Сколько именно добавить белка? (например +20г или +15%)
- Сколько убрать углеводов? (компенсировать всё белком или частично?)
- Какая цель пользователя? (набор массы, похудение, поддержание)

Правила:
- Если пользователь просит «оставь калории», сохраняй целевую калорийность и перераспределяй макросы
- Соблюдай безопасные минимумы: белок ≥1.4 г/кг, жир ≥0.6 г/кг
- Дефицит/профицит в диапазоне −25…+15% TDEE
- Если запрос экстремальный (например 9000 ккал), предложи разумный коридор
- ВСЕГДА объясняй свой выбор в поле "reasoning"

Формат ответа (ТОЛЬКО JSON, без markdown):
{
  "intent": "adjust_macros | set_calories | ask_clarification | accept_plan | unknown",
  "needs_clarification": true | false,
  "clarification_question": "текст вопроса для уточнения (если needs_clarification=true)",
  "reasoning": "почему ты сделал такой выбор, учитывая цель пользователя и контекст",
  "constraints": {
    "keep_calories": true | false,
    "target_calories": null | number
  },
  "protein": {"mode":"delta_g|delta_pct|target_g|none","value":number},
  "fat": {"mode":"delta_g|delta_pct|target_g|none","value":number},
  "carbs": {"mode":"delta_g|delta_pct|target_g|auto|none","value":number},
  "notes": "краткий смысл пожелания"
}

Примеры:
1. "хочу больше белка и меньше углей, калории те же"
{"intent":"ask_clarification","needs_clarification":true,"clarification_question":"Понял! Сколько именно белка добавить? Например:\n• +20г белка, остальное компенсировать углями\n• +15% белка от текущего\n• довести до 2г/кг веса","reasoning":"Запрос неоднозначный, нужно уточнить конкретные значения","constraints":{"keep_calories":true,"target_calories":null},"protein":{"mode":"none","value":0},"fat":{"mode":"none","value":0},"carbs":{"mode":"none","value":0},"notes":"требуется уточнение"}

2. "добавь 30г белка, калории оставь"
{"intent":"adjust_macros","needs_clarification":false,"clarification_question":"","reasoning":"Чёткий запрос: +30г белка, калории сохранить. Компенсирую углеводами (−30г×4÷4 = −30г углей)","constraints":{"keep_calories":true,"target_calories":null},"protein":{"mode":"delta_g","value":30},"fat":{"mode":"none","value":0},"carbs":{"mode":"auto","value":0},"notes":"увеличить белок на 30г, сохранить калории"}

3. "углей много — минус 15%"
{"intent":"adjust_macros","needs_clarification":false,"clarification_question":"","reasoning":"Снижаю углеводы на 15%. Калории уменьшатся, белок и жиры оставляю без изменений","constraints":{"keep_calories":false,"target_calories":null},"protein":{"mode":"none","value":0},"fat":{"mode":"none","value":0},"carbs":{"mode":"delta_pct","value":-15},"notes":"снизить долю углеводов на 15%"}

4. "мне нужно 9000 калорий"
{"intent":"set_calories","needs_clarification":false,"clarification_question":"","reasoning":"9000 ккал сильно выше TDEE. Это экстремальный запрос, требуется подтверждение","constraints":{"keep_calories":false,"target_calories":9000},"protein":{"mode":"none","value":0},"fat":{"mode":"none","value":0},"carbs":{"mode":"none","value":0},"notes":"запрос сверхвысокой калорийности"}`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' }, status: 200 })
  }
  
  try {
    const update = await req.json()
    
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query)
      return success()
    }
    
    if (update.message) {
      const message = update.message
      const chatId = message.chat.id
      const userId = message.from.id
      const text = message.text
      const voice = message.voice
      
      // Обработка фото/видео - отказ
      if (message.photo || message.video) {
        await sendMessage(chatId, '📸 Фото не принимаю. Вводи цифры или голосом.', getMainMenuInline())
        return success()
      }
      
      if (text?.startsWith('/start')) {
        await handleStart(chatId, userId, message.from.username)
        return success()
      }
      
      if (text?.startsWith('/wipe')) {
        await handleWipe(chatId, userId)
        return success()
      }
      
      if (text?.startsWith('/debug')) {
        const user = await getUser(userId)
        const debugInfo = `🔍 Debug Info:
User ID: ${userId}
Age: ${user?.age || 'null'}
Sex: ${user?.sex || 'null'}
Height: ${user?.height_cm || 'null'}
Weight: ${user?.weight_kg || 'null'}
Activity: ${user?.activity || 'null'}
Goal: ${user?.goal || 'null'}

Profile complete: ${!(!user?.age || !user?.sex || !user?.height_cm || !user?.weight_kg || !user?.activity || !user?.goal)}`
        await sendMessage(chatId, debugInfo)
        return success()
      }
      
      if (text?.startsWith('/clearkb')) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
            text: '✅ Клавиатура удалена. Теперь отправь /start',
            reply_markup: { remove_keyboard: true }
            })
          })
        return success()
      }
      
      if (voice) {
        await handleVoice(chatId, userId, voice)
        return success()
      }
        
        if (text) {
        await handleText(chatId, userId, text)
        return success()
      }
    }
    
    return success()
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

function success() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })
}

async function sendMessage(chatId: number, text: string, replyMarkup?: any) {
  const body: any = { chat_id: chatId, text, parse_mode: 'HTML' }
  
  if (replyMarkup) {
    body.reply_markup = replyMarkup
  }
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function answerCallback(callbackId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  })
}

async function getUserState(userId: number): Promise<UserState> {
  const { data } = await supabase
    .from('state')
    .select('last_menu')
            .eq('user_id', userId)
    .maybeSingle()
  
  return (data?.last_menu as UserState) || 'none'
}

async function setUserState(userId: number, state: UserState) {
          await supabase
    .from('state')
    .upsert({ user_id: userId, last_menu: state }, { onConflict: 'user_id' })
}

async function getUser(userId: number) {
  const { data } = await supabase
    .from('users')
            .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  
  return data
}

async function getActivePlan(userId: number) {
  // Проверяем кеш
  const cached = plansCache.get(userId)
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.plan
  }
  
  // Загружаем из БД
  const { data } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  
  // Сохраняем в кеш
  if (data) {
    plansCache.set(userId, { plan: data, timestamp: Date.now() })
  }
  
  return data
}

function invalidatePlanCache(userId: number) {
  plansCache.delete(userId)
}

async function ensureUser(userId: number, username?: string) {
  const user = await getUser(userId)
  if (!user) {
    await supabase.from('users').insert({
      user_id: userId,
      username: username,
      calories_goal: 2000,
      protein_goal: 150,
      carbs_goal: 200,
      fat_goal: 70
    })
  }
}

function getMainMenuInline() {
  return {
    inline_keyboard: [
      [
        { text: '👤 Профиль', callback_data: 'menu_profile' },
        { text: '📊 План КБЖУ', callback_data: 'menu_calculate' }
      ],
      [
        { text: '💬 Настроить', callback_data: 'menu_discussion' },
        { text: '📅 Сегодня', callback_data: 'menu_today' }
      ]
    ]
  }
}

// === ОБРАБОТЧИКИ ===

async function handleStart(chatId: number, userId: number, username?: string) {
  await ensureUser(userId, username)
  
  const user = await getUser(userId)
  
  // Проверяем, заполнен ли профиль
  const profileIncomplete = !user?.age || !user?.sex || !user?.height_cm || !user?.weight_kg || !user?.activity || !user?.goal
  
  if (profileIncomplete) {
    // Первый запуск - только inline-кнопка
    await setUserState(userId, 'none')
    
    const message = `🤖 <b>C.I.D. — Care · Insight · Discipline</b>

Помогу рассчитать рацион, вести учёт и давать советы.
Чтобы начать — заполните короткую форму.`
    
    await sendMessage(chatId, message, {
      inline_keyboard: [[{ text: '📝 Заполнить форму', callback_data: 'profile_edit' }]]
    })
    return // ВАЖНО: не показываем главное меню
  }
  
  // Профиль заполнен - показываем главное меню (inline)
  await setUserState(userId, 'none')
  
  const message = `🤖 <b>C.I.D. — Care · Insight · Discipline</b>

Помогу рассчитать рацион, вести учёт и давать советы.`
  
  await sendMessage(chatId, message, getMainMenuInline())
}

async function handleWipe(chatId: number, userId: number) {
  await sendMessage(chatId, '⚠️ Удалить все данные?', {
    inline_keyboard: [
      [{ text: '✅ Да, удалить', callback_data: 'wipe_confirm' }],
      [{ text: '🔙 Отмена', callback_data: 'menu_main' }]
    ]
  })
}

async function handleCallbackQuery(query: any) {
  const chatId = query.message.chat.id
  const userId = query.from.id
  const data = query.data
  
  await answerCallback(query.id)
  
  switch (data) {
    case 'menu_main':
      await sendMessage(chatId, '🏠 Главное меню', getMainMenuInline())
      break
      
    case 'menu_profile':
      await handleProfileMenu(chatId, userId)
      break
      
    case 'menu_calculate':
      await handleCalculate(chatId, userId)
      break
      
    case 'menu_discussion':
      await startPlanDiscussion(chatId, userId)
      break
      
    case 'menu_today':
      await handleTodayMenu(chatId, userId)
      break
      
    // Напоминания и помощь убраны из главного меню (доступны через команды)
      
    case 'profile_edit':
      await startProfileWizard(chatId, userId)
      break
      
    case 'today_add_meal':
      await startMealInput(chatId, userId)
      break
      
    case 'today_summary':
      await showDaySummary(chatId, userId)
      break
      
    case 'accept_plan':
      await acceptPlan(chatId, userId)
      break
      
    case 'wipe_confirm':
      await wipeUserData(chatId, userId)
      break
      
    default:
      if (data.startsWith('set_')) {
        await handleProfileCallback(chatId, userId, data)
      } else if (data.startsWith('confirm_calories_')) {
        await handleCaloriesConfirm(chatId, userId, data)
      } else if (data.startsWith('force_calories_')) {
        await handleForceCalories(chatId, userId, data)
      } else if (data.startsWith('apply_plan_')) {
        await handleApplyPlan(chatId, userId, data)
      } else if (data === 'manual_macros_input') {
        await startManualMacrosInput(chatId, userId)
      } else {
        await sendMessage(chatId, 'Не понял. Выбери действие ниже ⬇️', getMainMenuInline())
      }
  }
}

async function handleText(chatId: number, userId: number, text: string) {
  const state = await getUserState(userId)
  
  // Обработка FSM состояний
  if (state === 'plan_discussion') {
    await handlePlanDiscussion(chatId, userId, text)
  } else if (state === 'custom_calories') {
    await handleCustomCalories(chatId, userId, text)
  } else if (state === 'manual_protein') {
    await handleManualProtein(chatId, userId, text)
  } else if (state === 'manual_fat') {
    await handleManualFat(chatId, userId, text)
  } else if (state === 'manual_carbs') {
    await handleManualCarbs(chatId, userId, text)
  } else if (state === 'profile_age') {
    await handleProfileAge(chatId, userId, text)
  } else if (state === 'profile_height') {
    await handleProfileHeight(chatId, userId, text)
  } else if (state === 'profile_weight') {
    await handleProfileWeight(chatId, userId, text)
  } else if (state === 'profile_tz') {
    await handleProfileTz(chatId, userId, text)
  } else if (state === 'meal_input') {
    await handleMealInput(chatId, userId, text)
  } else {
    await sendMessage(chatId, 'Не понял. Выбери действие ниже ⬇️', getMainMenuInline())
  }
}

async function handleVoice(chatId: number, userId: number, voice: any) {
  await sendMessage(chatId, '🎤 Обрабатываю голосовое сообщение...')
  
  try {
    const fileId = voice.file_id
    const fileUrl = await getFileUrl(fileId)
    const transcribedText = await transcribeVoice(fileUrl)
    
    if (!transcribedText) {
      await sendMessage(chatId, '❌ Не удалось распознать. Попробуй ещё раз.')
      return
    }
    
    await sendMessage(chatId, `🗣️ Вы сказали: "${transcribedText}"`)
    
    // Голос работает как текст
    const state = await getUserState(userId)
    if (state === 'plan_discussion') {
      await handlePlanDiscussion(chatId, userId, transcribedText)
    } else {
      await handleText(chatId, userId, transcribedText)
    }
    
  } catch (error) {
    console.error('Voice error:', error)
    await sendMessage(chatId, '❌ Ошибка обработки голоса')
  }
}

async function getFileUrl(fileId: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function transcribeVoice(fileUrl: string): Promise<string | null> {
  try {
    const audioResponse = await fetch(fileUrl)
    const audioBlob = await audioResponse.blob()
    
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData
    })
    
    const result = await response.json()
    return result.text || null
  } catch (error) {
    console.error('Transcription error:', error)
    return null
  }
}

// === ДИАЛОГ О ПЛАНЕ (LLM-DRIVEN) ===

async function startPlanDiscussion(chatId: number, userId: number) {
  const { data: plan } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  
  if (!plan) {
    await sendMessage(chatId, '❌ Сначала рассчитайте план', {
      inline_keyboard: [[{ text: '📊 План КБЖУ', callback_data: 'menu_calculate' }]]
    })
    return
  }
  
  await setUserState(userId, 'plan_discussion')
  
  const message = `💬 <b>Настройка плана в диалоге</b>

Текущий план:
🥩 Белок: ${plan.p} г · 🥑 Жиры: ${plan.f} г · 🍞 Углеводы: ${plan.c} г
📊 Калории: ${plan.kcal} ккал

Скажите в свободной форме, что хотите изменить:
• "добавь 30г белка, калории оставь"
• "углей многовато, срежь на 15%"
• "поставь белок 160 г"

<b>Для точного ввода:</b>
• "вручную: 180г белка, 90г жиров, 250г углей"

Или используйте голос 🎤`
  
  await sendMessage(chatId, message)
}

async function handlePlanDiscussion(chatId: number, userId: number, text: string) {
  try {
    // Проверяем, не пытается ли пользователь ввести макросы вручную
    if (text.match(/вручную|калории|ккал/i)) {
      await setUserState(userId, 'custom_calories')
      await handleCustomCalories(chatId, userId, text)
      return
    }
    
    // Получаем текущий план и пользователя
    const user = await getUser(userId)
    const { data: currentPlan } = await supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()
    
    if (!currentPlan || !user) {
      await sendMessage(chatId, '❌ Ошибка получения данных')
      return
    }
    
    // Получаем историю корректировок
    const { data: planHistory } = await supabase
      .from('plans')
      .select('rules_json, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3)
    
    const historyContext = planHistory && planHistory.length > 1 
      ? `\n\nИстория корректировок:\n${planHistory.slice(1).map((p, i) => `${i+1}. ${p.rules_json?.notes || 'нет данных'}`).join('\n')}`
      : ''
    
    const goalText = user.goal === 'fat_loss' ? 'похудение (дефицит −15%)' : 
                     user.goal === 'gain' ? 'набор массы (профицит +10%)' : 
                     'поддержание веса'
    
    // Отправляем в LLM с полным контекстом
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
Цель: ${goalText}
Вес: ${user.weight_kg}кг
TDEE: ${calculateTDEE(user)} ккал
Текущий план: ${currentPlan.kcal} ккал | Б${currentPlan.p}г Ж${currentPlan.f}г У${currentPlan.c}г
Источник плана: ${currentPlan.source === 'manual' ? 'ручная корректировка' : 'автоматический расчёт'}${historyContext}

ЗАПРОС: "${text}"` 
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
    
    const intentJson = completion.choices[0].message.content
    if (!intentJson) {
      throw new Error('Empty response from LLM')
    }
    
    const intent = JSON.parse(intentJson)
    
    // Если LLM требует уточнения
    if (intent.needs_clarification && intent.clarification_question) {
      await sendMessage(chatId, `💬 ${intent.clarification_question}`)
      return
    }
    
    // Применяем изменения
    await applyPlanChanges(chatId, userId, intent, currentPlan, user)
    
  } catch (error) {
    console.error('Plan discussion error:', error)
    await sendMessage(chatId, `❌ Не до конца понял. 

Попробуйте ещё раз или используйте формат:
• вручную: 180g 90g 250g (белок, жир, углеводы)
• калории 3000`)
  }
}

async function applyPlanChanges(chatId: number, userId: number, intent: any, currentPlan: any, user: any) {
  const tdee = calculateTDEE(user)
  
  // Проверка на экстремальные запросы
  if (intent.intent === 'set_calories' && intent.constraints.target_calories) {
    const targetCal = intent.constraints.target_calories
    const minCal = Math.round(tdee * 0.75)
    const maxCal = Math.round(tdee * 1.15)
    
    if (targetCal > maxCal || targetCal < minCal) {
      const suggestedCal = targetCal > maxCal ? maxCal : minCal
      
      // Добавляем reasoning от LLM
      let reasoningText = ''
      if (intent.reasoning) {
        reasoningText = `\n\n💡 <b>Почему не ${targetCal}:</b>\n${intent.reasoning}`
      }
      
      await sendMessage(chatId, `⚠️ Запрос ${targetCal} ккал выходит за безопасный коридор (ваш TDEE ≈${tdee}).

Для ${targetCal > maxCal ? 'массонабора' : 'похудения'} рекомендую ${suggestedCal} ккал.${reasoningText}

Подтвердить ${suggestedCal} ккал?`, {
        inline_keyboard: [
          [{ text: `✅ Принять ${suggestedCal}`, callback_data: `confirm_calories_${suggestedCal}` }],
          [{ text: `⚠️ Применить ${targetCal}`, callback_data: `force_calories_${targetCal}` }]
        ]
      })
      return
    }
  }
  
  // Применяем изменения
  let newP = currentPlan.p
  let newF = currentPlan.f
  let newC = currentPlan.c
  let newKcal = currentPlan.kcal
  
  // Белок
  if (intent.protein.mode === 'delta_g') {
    newP += intent.protein.value
  } else if (intent.protein.mode === 'delta_pct') {
    newP = Math.round(newP * (1 + intent.protein.value / 100))
  } else if (intent.protein.mode === 'target_g') {
    newP = intent.protein.value
  }
  
  // Жиры
  if (intent.fat.mode === 'delta_g') {
    newF += intent.fat.value
  } else if (intent.fat.mode === 'delta_pct') {
    newF = Math.round(newF * (1 + intent.fat.value / 100))
  } else if (intent.fat.mode === 'target_g') {
    newF = intent.fat.value
  }
  
  // Углеводы
  if (intent.carbs.mode === 'delta_g') {
    newC += intent.carbs.value
  } else if (intent.carbs.mode === 'delta_pct') {
    newC = Math.round(newC * (1 + intent.carbs.value / 100))
  } else if (intent.carbs.mode === 'target_g') {
    newC = intent.carbs.value
  }
  
  // Проверка минимумов
  const minProtein = Math.round(user.weight_kg * 1.4)
  const minFat = Math.round(user.weight_kg * 0.6)
  
  let warnings: string[] = []
  if (newP < minProtein) {
    warnings.push(`Белок поднят до минимума ${minProtein}г (1.4 г/кг)`)
    newP = minProtein
  }
  if (newF < minFat) {
    warnings.push(`Жиры подняты до минимума ${minFat}г (0.6 г/кг)`)
    newF = minFat
  }
  
  // Пересчёт калорий
  if (intent.constraints.keep_calories) {
    // Сохраняем калории, корректируем углеводы
    const proteinCal = newP * 4
    const fatCal = newF * 9
    const carbsCal = currentPlan.kcal - proteinCal - fatCal
    newC = Math.round(carbsCal / 4)
    newKcal = currentPlan.kcal
  } else if (intent.carbs.mode === 'auto') {
    // Автоматический расчёт углеводов
    newKcal = Math.round((newP * 4) + (newF * 9) + (newC * 4))
  } else {
    newKcal = Math.round((newP * 4) + (newF * 9) + (newC * 4))
  }
  
  // Сохраняем новый план
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: newKcal,
    p: newP,
    f: newF,
    c: newC,
    source: 'manual',
    is_active: true,
    rules_json: intent
  })
  
  // Инвалидируем кеш
  invalidatePlanCache(userId)
  
  // Формируем ответ
  const deltaP = newP - currentPlan.p
  const deltaF = newF - currentPlan.f
  const deltaC = newC - currentPlan.c
  const deltaKcal = newKcal - currentPlan.kcal
  
  let explanation = intent.notes || 'План обновлён'
  if (intent.constraints.keep_calories) {
    explanation += `. Калории сохранены (${newKcal} ккал)`
  }
  
  let changesText: string[] = []
  if (deltaP !== 0) changesText.push(`Белок ${deltaP > 0 ? '+' : ''}${deltaP}г`)
  if (deltaF !== 0) changesText.push(`Жиры ${deltaF > 0 ? '+' : ''}${deltaF}г`)
  if (deltaC !== 0) changesText.push(`Углеводы ${deltaC > 0 ? '+' : ''}${deltaC}г`)
  if (deltaKcal !== 0) changesText.push(`Калории ${deltaKcal > 0 ? '+' : ''}${deltaKcal}`)
  
  // Добавляем reasoning от LLM если есть
  let reasoningText = ''
  if (intent.reasoning) {
    reasoningText = `\n\n💡 <b>Почему так:</b>\n${intent.reasoning}`
  }
  
  let message = `✅ ${explanation}

${changesText.join(', ')}

<b>Новый план:</b>
🥩 Б ${newP}г · 🥑 Ж ${newF}г · 🍞 У ${newC}г · 📊 ${newKcal} ккал${reasoningText}`
  
  if (warnings.length > 0) {
    message += `\n\n⚠️ ${warnings.join('. ')}`
  }
  
  await setUserState(userId, 'none')
  await sendMessage(chatId, message, getMainMenuInline())
}

async function handleCaloriesConfirm(chatId: number, userId: number, data: string) {
  const calories = parseInt(data.replace('confirm_calories_', ''))
  
  const user = await getUser(userId)
  if (!user) return
  
  // Рассчитываем макросы для новой калорийности
  const proteinG = Math.round(user.weight_kg * 1.6)
  const fatG = Math.round(user.weight_kg * 0.8)
  const carbsG = Math.round((calories - (proteinG * 4) - (fatG * 9)) / 4)
  
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: calories,
    p: proteinG,
    f: fatG,
    c: carbsG,
    source: 'manual',
    is_active: true
  })
  
  invalidatePlanCache(userId)
  
  await sendMessage(chatId, `✅ План обновлён

🥩 Б ${proteinG}г · 🥑 Ж ${fatG}г · 🍞 У ${carbsG}г · 📊 ${calories} ккал`, getMainMenuInline())
}

async function handleForceCalories(chatId: number, userId: number, data: string) {
  const calories = parseInt(data.replace('force_calories_', ''))
  
  const user = await getUser(userId)
  if (!user) return
  
  const tdee = calculateTDEE(user)
  const goalText = user.goal === 'fat_loss' ? 'похудение' : 
                   user.goal === 'gain' ? 'набор массы' : 
                   'поддержание веса'
  
  // Запрашиваем у LLM оптимальное распределение БЖУ для запрошенных калорий
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `Ты — нутрициолог. Рассчитай оптимальное распределение БЖУ для ТОЧНО заданной калорийности.

ВАЖНО: Сумма калорий из БЖУ ДОЛЖНА равняться целевой калорийности!
Формула: (белок_г × 4) + (жиры_г × 9) + (углеводы_г × 4) = целевые_калории

Правила:
- Белок: 1.6-2.2 г/кг (для набора массы ближе к 2.2, для похудения 1.8-2.0)
- Жиры: 0.8-1.2 г/кг (минимум 0.6 г/кг)
- Углеводы: рассчитываются так, чтобы сумма калорий была ТОЧНО равна целевой
- Верни ТОЛЬКО JSON без markdown

Алгоритм:
1. Определи белок (г/кг × вес)
2. Определи жиры (г/кг × вес)
3. Рассчитай углеводы: (целевые_ккал - белок×4 - жиры×9) / 4
4. Проверь: белок×4 + жиры×9 + углеводы×4 = целевые_ккал

Формат ответа:
{
  "protein_g": число,
  "fat_g": число,
  "carbs_g": число,
  "reasoning": "почему именно такое распределение для этой цели и калорийности"
}` 
        },
        { 
          role: 'user', 
          content: `Целевые калории: ${calories} ккал (ТОЧНО!)
Вес: ${user.weight_kg} кг
Цель: ${goalText}
TDEE: ${tdee} ккал

Рассчитай БЖУ так, чтобы сумма калорий была РОВНО ${calories} ккал.` 
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
    
    const result = JSON.parse(completion.choices[0].message.content || '{}')
    let proteinG = Math.round(result.protein_g || user.weight_kg * 1.8)
    let fatG = Math.round(result.fat_g || user.weight_kg * 0.9)
    let carbsG = Math.round(result.carbs_g || 0)
    
    // ПРОВЕРКА: пересчитываем калории из БЖУ
    const calculatedCalories = (proteinG * 4) + (fatG * 9) + (carbsG * 4)
    const diff = Math.abs(calculatedCalories - calories)
    
    // Если разница больше 50 ккал — пересчитываем углеводы
    if (diff > 50) {
      carbsG = Math.round((calories - (proteinG * 4) - (fatG * 9)) / 4)
      console.log(`LLM ошиблась: ${calculatedCalories} вместо ${calories}. Пересчитали углеводы: ${carbsG}г`)
    }
    
    await sendMessage(chatId, `💡 <b>Рекомендую для ${calories} ккал:</b>

🥩 Белок: ${proteinG} г
🥑 Жиры: ${fatG} г  
🍞 Углеводы: ${carbsG} г
📊 Калории: ${calories} ккал

<b>Почему так:</b>
${result.reasoning || 'Оптимальное распределение для вашей цели'}

⚠️ <b>Внимание:</b> ${calories} ккал ${calories > tdee * 1.15 ? 'значительно превышает' : 'значительно ниже'} ваш TDEE (≈${tdee} ккал).`, {
      inline_keyboard: [
        [{ text: '✅ Принять план', callback_data: `apply_plan_${proteinG}_${fatG}_${carbsG}_${calories}` }],
        [{ text: '✏️ Внести вручную', callback_data: 'manual_macros_input' }]
      ]
    })
    
  } catch (error) {
    console.error('LLM error:', error)
    // Фоллбек: стандартный расчёт
    const proteinG = Math.round(user.weight_kg * 1.8)
    const fatG = Math.round(user.weight_kg * 0.9)
    const carbsG = Math.round((calories - (proteinG * 4) - (fatG * 9)) / 4)
    
    await sendMessage(chatId, `💡 <b>Рекомендую для ${calories} ккал:</b>

🥩 Белок: ${proteinG} г
🥑 Жиры: ${fatG} г  
🍞 Углеводы: ${carbsG} г

⚠️ ${calories} ккал ${calories > tdee * 1.15 ? 'превышает' : 'ниже'} ваш TDEE (≈${tdee} ккал).`, {
      inline_keyboard: [
        [{ text: '✅ Принять план', callback_data: `apply_plan_${proteinG}_${fatG}_${carbsG}_${calories}` }],
        [{ text: '✏️ Внести вручную', callback_data: 'manual_macros_input' }]
      ]
    })
  }
}

async function handleApplyPlan(chatId: number, userId: number, data: string) {
  const parts = data.replace('apply_plan_', '').split('_')
  const proteinG = parseInt(parts[0])
  const fatG = parseInt(parts[1])
  const carbsG = parseInt(parts[2])
  const calories = parseInt(parts[3])
  
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: calories,
    p: proteinG,
    f: fatG,
    c: carbsG,
    source: 'manual',
    is_active: true,
    rules_json: { notes: `LLM-оптимизированный план для ${calories} ккал` }
  })
  
  invalidatePlanCache(userId)
  
  await sendMessage(chatId, `✅ <b>План применён!</b>

🥩 Белок: ${proteinG} г
🥑 Жиры: ${fatG} г
🍞 Углеводы: ${carbsG} г
📊 Калории: ${calories} ккал`, getMainMenuInline())
}

async function startManualMacrosInput(chatId: number, userId: number) {
  await setUserState(userId, 'manual_protein')
  // Сохраняем временные данные в state
  await supabase.from('state').upsert({ 
    user_id: userId, 
    last_menu: 'manual_protein',
    last_msgs_json: {} 
  }, { onConflict: 'user_id' })
  
  await sendMessage(chatId, '✏️ <b>Ручной ввод КБЖУ</b>\n\nШаг 1/3: Сколько грамм <b>белка</b>?\n\nПример: 180')
}

async function handleManualProtein(chatId: number, userId: number, text: string) {
  const protein = parseInt(text.match(/(\d+)/)?.[1] || '0')
  
  if (!protein || protein < 50 || protein > 500) {
    await sendMessage(chatId, '❌ Введите корректное значение белка (50-500г)')
    return
  }
  
  // Сохраняем белок
  await supabase.from('state').update({ 
    last_msgs_json: { protein } 
  }).eq('user_id', userId)
  
  await setUserState(userId, 'manual_fat')
  await sendMessage(chatId, `✅ Белок: ${protein}г\n\nШаг 2/3: Сколько грамм <b>жиров</b>?\n\nПример: 90`)
}

async function handleManualFat(chatId: number, userId: number, text: string) {
  const fat = parseInt(text.match(/(\d+)/)?.[1] || '0')
  
  if (!fat || fat < 30 || fat > 300) {
    await sendMessage(chatId, '❌ Введите корректное значение жиров (30-300г)')
    return
  }
  
  // Получаем белок и сохраняем жир
  const { data: stateData } = await supabase
    .from('state')
    .select('last_msgs_json')
    .eq('user_id', userId)
    .single()
  
  const protein = stateData?.last_msgs_json?.protein || 0
  
  await supabase.from('state').update({ 
    last_msgs_json: { protein, fat } 
  }).eq('user_id', userId)
  
  await setUserState(userId, 'manual_carbs')
  await sendMessage(chatId, `✅ Белок: ${protein}г, Жиры: ${fat}г\n\nШаг 3/3: Сколько грамм <b>углеводов</b>?\n\nПример: 250`)
}

async function handleManualCarbs(chatId: number, userId: number, text: string) {
  const carbs = parseInt(text.match(/(\d+)/)?.[1] || '0')
  
  if (!carbs || carbs < 0 || carbs > 2000) {
    await sendMessage(chatId, '❌ Введите корректное значение углеводов (0-2000г)')
    return
  }
  
  // Получаем белок и жир
  const { data: stateData } = await supabase
    .from('state')
    .select('last_msgs_json')
    .eq('user_id', userId)
    .single()
  
  const protein = stateData?.last_msgs_json?.protein || 0
  const fat = stateData?.last_msgs_json?.fat || 0
  const calories = (protein * 4) + (fat * 9) + (carbs * 4)
  
  // Сохраняем план
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: calories,
    p: protein,
    f: fat,
    c: carbs,
    source: 'manual',
    is_active: true,
    rules_json: { notes: 'Ручной ввод КБЖУ пользователем' }
  })
  
  invalidatePlanCache(userId)
  
  await setUserState(userId, 'none')
  await sendMessage(chatId, `✅ <b>План создан!</b>

🥩 Белок: ${protein} г
🥑 Жиры: ${fat} г
🍞 Углеводы: ${carbs} г
📊 Калории: ${calories} ккал`, getMainMenuInline())
}

async function acceptPlan(chatId: number, userId: number) {
  await setUserState(userId, 'none')
  await sendMessage(chatId, '✅ План принят!', getMainMenuInline())
}

// === КАСТОМНЫЕ КАЛОРИИ/МАКРОСЫ ===

async function handleCustomCalories(chatId: number, userId: number, text: string) {
  // Получаем текущий план и пользователя
  const user = await getUser(userId)
  const { data: currentPlan } = await supabase
    .from('plans')
      .select('*')
      .eq('user_id', userId)
    .eq('is_active', true)
      .single()
    
  if (!currentPlan || !user) {
    await sendMessage(chatId, '❌ Ошибка получения данных')
    return
  }
  
  // Парсим различные форматы ввода
  // Форматы: "вручную: 180g 90g 250g", "180 90 250", "калории 3000", "9000 ккал"
  
  let newP: number | null = null
  let newF: number | null = null
  let newC: number | null = null
  let newKcal: number | null = null
  
  // Проверка формата "вручную: XXXg XXXg XXXg"
  const manualMatch = text.match(/вручную[:\s]+(\d+)\D+(\d+)\D+(\d+)/i)
  if (manualMatch) {
    newP = parseInt(manualMatch[1])
    newF = parseInt(manualMatch[2])
    newC = parseInt(manualMatch[3])
  }
  
  // Проверка формата "калории 3000" или "3000 ккал"
  const caloriesMatch = text.match(/(?:калории|ккал)?\s*(\d+)\s*(?:ккал)?/i)
  if (caloriesMatch && !newP) {
    newKcal = parseInt(caloriesMatch[1])
  }
  
  // Валидация
  if (!newP && !newF && !newC && !newKcal) {
    await sendMessage(chatId, `❌ Не понял формат. Примеры:
• вручную: 180g 90g 250g
• калории 3000
• 2500 ккал`)
    return
  }
  
  // Если вводили макросы вручную
  if (newP && newF && newC) {
    // Проверяем минимумы
    const minProtein = Math.round(user.weight_kg * 1.4)
    const minFat = Math.round(user.weight_kg * 0.6)
    
    if (newP < minProtein) {
      await sendMessage(chatId, `⚠️ Белок ${newP}г ниже минимума (${minProtein}г). Поднял до минимума.`)
      newP = minProtein
    }
    if (newF < minFat) {
      await sendMessage(chatId, `⚠️ Жир ${newF}г ниже минимума (${minFat}г). Поднял до минимума.`)
      newF = minFat
    }
    
    newKcal = (newP * 4) + (newF * 9) + (newC * 4)
  } 
  // Если вводили только калории
  else if (newKcal) {
    if (newKcal < 500 || newKcal > 15000) {
      await sendMessage(chatId, '❌ Калории должны быть от 500 до 15000')
      return
    }
    
    // Проверяем на экстремальные значения
    const tdee = calculateTDEE(user)
    const minCal = Math.round(tdee * 0.75)
    const maxCal = Math.round(tdee * 1.15)
    
    if (newKcal > maxCal || newKcal < minCal) {
      const suggestedCal = newKcal > maxCal ? maxCal : minCal
      await setUserState(userId, 'none')
      await sendMessage(chatId, `⚠️ ${newKcal} ккал выходит за безопасный коридор (ваш TDEE ≈${tdee}).

Для ${newKcal > maxCal ? 'массонабора' : 'похудения'} рекомендую ${suggestedCal} ккал.

💡 <b>Почему:</b>
Экстремальные калории (${newKcal > maxCal ? 'выше +15%' : 'ниже −25%'} от TDEE) могут быть небезопасны. Рекомендую придерживаться коридора ${minCal}–${maxCal} ккал.

Если вы уверены в своём выборе, используйте формат:
• "вручную: 180г белка, 90г жиров, 250г углей"`, {
        inline_keyboard: [
          [{ text: `✅ Принять ${suggestedCal}`, callback_data: `confirm_calories_${suggestedCal}` }]
        ]
      })
      return
    }
    
    newP = Math.round(user.weight_kg * 1.6)
    newF = Math.round(user.weight_kg * 0.8)
    newC = Math.round((newKcal - (newP * 4) - (newF * 9)) / 4)
  }
  
  if (!newKcal || !newP || !newF || !newC) {
    await sendMessage(chatId, '❌ Ошибка расчёта. Попробуйте ещё раз.')
    return
  }
  
  // Сохраняем новый план
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: newKcal,
    p: newP,
    f: newF,
    c: newC,
    source: 'manual',
    is_active: true
  })
  
  invalidatePlanCache(userId)
  
  await setUserState(userId, 'none')
  
  const tdee = calculateTDEE(user)
  let warning = ''
  if (newKcal > tdee * 1.15 || newKcal < tdee * 0.75) {
    warning = `\n\n⚠️ <b>Внимание:</b> ${newKcal} ккал выходит за безопасный коридор (ваш TDEE ≈${tdee} ккал).`
  }
  
  const message = `✅ <b>План обновлён!</b>

🥩 Белок: ${newP} г · 🥑 Жиры: ${newF} г · 🍞 Углеводы: ${newC} г
📊 Калории: ${newKcal} ккал${warning}`
  
  await sendMessage(chatId, message, getMainMenuInline())
}

// === ПРОФИЛЬ ===

async function handleProfileMenu(chatId: number, userId: number) {
  const user = await getUser(userId)
  
  let profileText = '👤 <b>Профиль</b>\n\n'
  
  if (user?.age) {
    profileText += `Возраст: ${user.age} лет\n`
    profileText += `Пол: ${user.sex === 'male' ? 'Мужской' : 'Женский'}\n`
    profileText += `Рост: ${user.height_cm} см\n`
    profileText += `Вес: ${user.weight_kg} кг\n`
    profileText += `Активность: ${getActivityText(user.activity)}\n`
    profileText += `Цель: ${getGoalText(user.goal)}\n`
  } else {
    profileText += 'Профиль не заполнен'
  }
  
  await sendMessage(chatId, profileText, {
    inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: 'profile_edit' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  })
}

async function startProfileWizard(chatId: number, userId: number) {
  await setUserState(userId, 'profile_age')
  await sendMessage(chatId, '👤 Начнём заполнение профиля.\n\nСколько вам лет? (например: 30)')
}

async function handleProfileAge(chatId: number, userId: number, text: string) {
  const age = parseInt(text)
  if (isNaN(age) || age < 10 || age > 100) {
    await sendMessage(chatId, '❌ Введите корректный возраст (10-100 лет)')
    return
  }
  
  await supabase.from('users').update({ age }).eq('user_id', userId)
  await setUserState(userId, 'profile_sex')
  
  await sendMessage(chatId, 'Укажите ваш пол:', {
    inline_keyboard: [
      [{ text: 'Мужской', callback_data: 'set_sex_male' }],
      [{ text: 'Женский', callback_data: 'set_sex_female' }]
    ]
  })
}

async function handleProfileCallback(chatId: number, userId: number, data: string) {
  if (data === 'set_sex_male' || data === 'set_sex_female') {
    const sex = data === 'set_sex_male' ? 'male' : 'female'
    await supabase.from('users').update({ sex }).eq('user_id', userId)
    await setUserState(userId, 'profile_height')
    await sendMessage(chatId, 'Какой у вас рост в сантиметрах? (например: 180)')
  } else if (data.startsWith('set_activity_')) {
    const activity = data.replace('set_activity_', '')
    await supabase.from('users').update({ activity }).eq('user_id', userId)
    await setUserState(userId, 'profile_goal')
    await sendMessage(chatId, 'Ваша цель?', {
      inline_keyboard: [
        [{ text: 'Сбросить вес', callback_data: 'set_goal_fat_loss' }],
        [{ text: 'Поддержать вес', callback_data: 'set_goal_maintain' }],
        [{ text: 'Набрать вес', callback_data: 'set_goal_gain' }]
      ]
    })
  } else if (data.startsWith('set_goal_')) {
    const goal = data.replace('set_goal_', '')
    await supabase.from('users').update({ goal }).eq('user_id', userId)
    await setUserState(userId, 'profile_tz')
    await sendMessage(chatId, 'Введите ваш часовой пояс (например: Europe/Moscow)')
  }
}

async function handleProfileHeight(chatId: number, userId: number, text: string) {
  const height = parseFloat(text)
  if (isNaN(height) || height < 100 || height > 250) {
    await sendMessage(chatId, '❌ Введите корректный рост (100-250 см)')
    return
  }
  
  await supabase.from('users').update({ height_cm: height }).eq('user_id', userId)
  await setUserState(userId, 'profile_weight')
  await sendMessage(chatId, 'Какой у вас текущий вес в килограммах? (например: 75.5)')
}

async function handleProfileWeight(chatId: number, userId: number, text: string) {
  const weight = parseFloat(text)
  if (isNaN(weight) || weight < 30 || weight > 300) {
    await sendMessage(chatId, '❌ Введите корректный вес (30-300 кг)')
    return
  }
  
  await supabase.from('users').update({ weight_kg: weight }).eq('user_id', userId)
  await setUserState(userId, 'profile_activity')
  
  await sendMessage(chatId, 'Ваш уровень активности?', {
    inline_keyboard: [
      [{ text: 'Сидячий', callback_data: 'set_activity_sedentary' }],
      [{ text: 'Легкий', callback_data: 'set_activity_light' }],
      [{ text: 'Умеренный', callback_data: 'set_activity_moderate' }],
      [{ text: 'Высокий', callback_data: 'set_activity_high' }],
      [{ text: 'Очень высокий', callback_data: 'set_activity_very_high' }]
    ]
  })
}

async function handleProfileTz(chatId: number, userId: number, text: string) {
  await supabase.from('users').update({ tz: text }).eq('user_id', userId)
  await setUserState(userId, 'none')
  
  // Автоматически переходим к расчету плана
  await sendMessage(chatId, '✅ Профиль сохранён! Рассчитываю ваш персональный план...')
  await handleCalculate(chatId, userId)
}

// === РАСЧЁТ КБЖУ ===

function calculateTDEE(user: any): number {
  let bmr: number
  if (user.sex === 'male') {
    bmr = (10 * user.weight_kg) + (6.25 * user.height_cm) - (5 * user.age) + 5
  } else {
    bmr = (10 * user.weight_kg) + (6.25 * user.height_cm) - (5 * user.age) - 161
  }
  
  const palFactors: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    high: 1.725,
    very_high: 1.9
  }
  
  return Math.round(bmr * palFactors[user.activity || 'sedentary'])
}

async function handleCalculate(chatId: number, userId: number) {
  const user = await getUser(userId)
  
  if (!user?.age || !user?.sex || !user?.height_cm || !user?.weight_kg || !user?.activity || !user?.goal) {
    await sendMessage(chatId, '❌ Сначала заполните профиль', {
      inline_keyboard: [[{ text: '📝 Заполнить форму', callback_data: 'profile_edit' }]]
    })
    return
  }
  
  const tdee = calculateTDEE(user)
  
  let targetKcal = tdee
  let goalAdjustment = '0%'
  if (user.goal === 'fat_loss') {
    targetKcal = Math.round(tdee * 0.85)
    goalAdjustment = '−15%'
  } else if (user.goal === 'gain') {
    targetKcal = Math.round(tdee * 1.10)
    goalAdjustment = '+10%'
  }
  
  const proteinG = Math.round(user.weight_kg * 1.6)
  const fatG = Math.round(user.weight_kg * 0.8)
  const carbsG = Math.round((targetKcal - (proteinG * 4) - (fatG * 9)) / 4)
  
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId)
  await supabase.from('plans').insert({
    user_id: userId,
    kcal: targetKcal,
    p: proteinG,
    f: fatG,
    c: carbsG,
    source: 'auto',
    is_active: true
  })
  
  invalidatePlanCache(userId)
  
  const message = `✅ <b>Готово! Я рассчитал план по формуле Mifflin–St Jeor и активности (PAL).</b>

TDEE: ${tdee} ккал → цель ${goalAdjustment} = ${targetKcal} ккал
🥩 Белок: ${proteinG} г · 🥑 Жиры: ${fatG} г · 🍞 Углеводы: ${carbsG} г

<b>Почему так:</b>
• Белок ~1.6 г/кг для сохранения мышц
• Жиры ~0.8 г/кг для гормонального фона
• Углеводы — остаток калорий

Хотите под себя? Скажите в свободной форме:
• "хочу больше белка и меньше углей, калории оставь"
• "углей многовато, срежь на 15%"
• "поставь белок 160 г"`
  
  await sendMessage(chatId, message, {
    inline_keyboard: [
      [{ text: '✅ Принять', callback_data: 'accept_plan' }],
      [{ text: '💬 Настроить', callback_data: 'menu_discussion' }]
    ]
  })
}

// === СЕГОДНЯ ===

async function handleTodayMenu(chatId: number, userId: number) {
  await sendMessage(chatId, '📅 <b>Сегодня</b>\n\nВыберите действие:', {
    inline_keyboard: [
      [{ text: '➕ Добавить приём', callback_data: 'today_add_meal' }],
      [{ text: '📈 Итог дня', callback_data: 'today_summary' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  })
}

async function startMealInput(chatId: number, userId: number) {
  await setUserState(userId, 'meal_input')
  await sendMessage(chatId, '🍽️ Введите калории и макросы\n\nПример: 620 ккал, Б45 Ж15 У70\nИли используйте голос 🎤')
}

async function handleMealInput(chatId: number, userId: number, text: string) {
  const kcalMatch = text.match(/(\d+)\s*к?кал/i)
  const proteinMatch = text.match(/[бb]\s*(\d+)/i)
  const fatMatch = text.match(/[жf]\s*(\d+)/i)
  const carbsMatch = text.match(/[уc]\s*(\d+)/i)
  
  if (!kcalMatch) {
    await sendMessage(chatId, '❌ Укажите калории. Пример: 620 ккал, Б45 Ж15 У70')
    return
  }
  
  const kcal = parseInt(kcalMatch[1])
  const protein = proteinMatch ? parseInt(proteinMatch[1]) : 0
  const fat = fatMatch ? parseInt(fatMatch[1]) : 0
  const carbs = carbsMatch ? parseInt(carbsMatch[1]) : 0
  
  await supabase.from('meals').insert({
    user_id: userId,
    meal_name: text,
    kcal,
    protein,
    fat,
    carbs,
    ts: new Date().toISOString()
  })
  
    const today = new Date().toISOString().split('T')[0]
    const { data: existing } = await supabase
    .from('daily_totals')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
    if (existing) {
    await supabase.from('daily_totals')
      .update({
        kcal: existing.kcal + kcal,
        p: existing.p + protein,
        f: existing.f + fat,
        c: existing.c + carbs
      })
        .eq('user_id', userId)
        .eq('date', today)
    } else {
    await supabase.from('daily_totals').insert({
          user_id: userId,
          date: today,
      kcal,
      p: protein,
      f: fat,
      c: carbs
    })
  }
  
  await setUserState(userId, 'none')
  await sendMessage(chatId, `✅ Добавлено в дневник

🔥 ${kcal} ккал
🥩 ${protein}г белка · 🥑 ${fat}г жиров · 🍞 ${carbs}г углеводов`, getMainMenuInline())
}

async function showDaySummary(chatId: number, userId: number) {
    const today = new Date().toISOString().split('T')[0]
    
  const { data: totals } = await supabase
    .from('daily_totals')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
  const { data: plan } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  
  if (!totals || !plan) {
    await sendMessage(chatId, '📊 Сегодня ещё нет приёмов пищи', getMainMenuInline())
    return
  }
  
  const kcalProgress = Math.round((totals.kcal / plan.kcal) * 100)
  
  let advice = ''
  if (totals.p < plan.p - 20) {
    advice = '\n\n💡 Совет: добери 10–15 г белка вечером.'
  } else if (kcalProgress > 110) {
    advice = '\n\n💡 Совет: превышение по калориям. Завтра уменьши порции.'
  } else if (Math.abs(kcalProgress - 100) < 10) {
    advice = '\n\n💡 Отличный баланс!'
  }
  
  const message = `📈 <b>Итог дня ${today}</b>

Сегодня: ${totals.kcal}/${plan.kcal} ккал (${kcalProgress}%)
🥩 Б ${totals.p}/${plan.p} · 🥑 Ж ${totals.f}/${plan.f} · 🍞 У ${totals.c}/${plan.c}${advice}`
  
  await sendMessage(chatId, message, getMainMenuInline())
}

// === НАПОМИНАНИЯ ===

async function handleRemindersMenu(chatId: number, userId: number) {
  await sendMessage(chatId, '⏰ <b>Напоминания</b>\n\nНастройка напоминаний в разработке', {
    inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu_main' }]]
  })
}

// === ПОМОЩЬ ===

async function handleHelp(chatId: number, userId: number) {
  const message = `❓ <b>Помощь</b>

<b>Основные функции:</b>
• Профиль — заполни данные для расчёта
• Рассчитать КБЖУ — получи персональный план с объяснением
• Настроить в диалоге — говори что хочешь изменить свободно
• Сегодня — добавляй приёмы и смотри итоги

<b>Примеры фраз для настройки:</b>
• "хочу больше белка и меньше углей, калории оставь"
• "углей многовато, срежь на 15%"
• "поставь белок 160 г"
• "мне нужно 3000 калорий"

<b>Голосовые команды:</b>
Используй голос 🎤 вместо текста — работает так же!

<b>Команды:</b>
/start — главное меню
/wipe — удалить все данные`
  
  await sendMessage(chatId, message, getMainMenuInline())
}

// === WIPE ===

async function wipeUserData(chatId: number, userId: number) {
  await supabase.from('meals').delete().eq('user_id', userId)
  await supabase.from('daily_totals').delete().eq('user_id', userId)
  await supabase.from('plans').delete().eq('user_id', userId)
  await supabase.from('preferences').delete().eq('user_id', userId)
  await supabase.from('state').delete().eq('user_id', userId)
  await supabase.from('reminders').delete().eq('user_id', userId)
  
  await supabase.from('users').update({
    age: null,
    sex: null,
    height_cm: null,
    weight_kg: null,
    activity: null,
    goal: null
  }).eq('user_id', userId)
  
  await sendMessage(chatId, '✅ Данные удалены. Начнём заново?', {
    inline_keyboard: [[{ text: '📝 Заполнить форму', callback_data: 'profile_edit' }]]
  })
}

// === ВСПОМОГАТЕЛЬНЫЕ ===

function getActivityText(activity: string): string {
  const map: Record<string, string> = {
    sedentary: 'Сидячий',
    light: 'Легкий',
    moderate: 'Умеренный',
    high: 'Высокий',
    very_high: 'Очень высокий'
  }
  return map[activity] || activity
}

function getGoalText(goal: string): string {
  const map: Record<string, string> = {
    fat_loss: 'Сбросить вес',
    maintain: 'Поддержать вес',
    gain: 'Набрать вес'
  }
  return map[goal] || goal
}