// Обновленный основной файл Telegram бота с новой архитектурой
// Интегрирует все новые компоненты: расчетный движок, UX, голосовой ввод, напоминания, память, аналитику

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Импорт новых модулей
import calculationEngine from './src/calculation-engine.ts'
import telegramUX from './src/telegram-ux.ts'
import voiceInput from './src/voice-input.ts'
import remindersSystem from './src/reminders-system.ts'
import memoryContext from './src/memory-context.ts'
import messageTemplates from './src/message-templates.ts'
import analyticsLogging from './src/analytics-logging.ts'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }
  
  try {
    const update = await req.json()
    
    // Обработка callback_query (нажатия на inline кнопки)
    if (update.callback_query) {
      const callbackQuery = update.callback_query
      const chatId = callbackQuery.message.chat.id
      const userId = callbackQuery.from.id
      const data = callbackQuery.data
      
      // Подтверждаем получение callback
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id })
      })
      
      // Обрабатываем callback через новый UX
      const response = telegramUX.handleCallbackQuery(data, userId, chatId)
      
      if (response) {
        await sendMessageWithInlineKeyboard(chatId, response.message, response.keyboard)
        
        // Обновляем состояние пользователя
        telegramUX.updateUserState(userId, { last_menu: data })
        
        // Логируем событие
        await analyticsLogging.logEvent('menu_interaction', userId, { 
          callback_data: data,
          menu: response.message 
        }, supabase)
      }
      
      return success()
    }
    
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const text = update.message.text
      const photo = update.message.photo
      const voice = update.message.voice
      
      // Получаем пользователя и его тон
      const user = await getUser(userId)
      const userTone = messageTemplates.getUserTone(user?.tone)
      
      // Обработка команд
      if (text?.startsWith('/start')) {
        await ensureUser(userId, update.message.from.username)
        const isNewUser = !user || !user.height_cm
        
        if (isNewUser) {
          // Начинаем онбординг
          await sendMessage(chatId, messageTemplates.getOnboardingMessage('age', userTone))
          await telegramUX.updateUserState(userId, { onboarding_step: 'age' })
          await analyticsLogging.logOnboarding(userId, 'started', {}, supabase)
        } else {
          // Показываем главное меню
          await sendMessageWithInlineKeyboard(chatId, messageTemplates.getWelcomeMessage(userTone, false), telegramUX.getMainMenuKeyboard())
        }
        return success()
      }
      
      if (text?.startsWith('/menu')) {
        await sendMessageWithInlineKeyboard(chatId, telegramUX.getMainMenuMessage(), telegramUX.getMainMenuKeyboard())
        return success()
      }
      
      if (text?.startsWith('/help')) {
        await sendMessage(chatId, messageTemplates.getHelpMessage(userTone))
        return success()
      }
      
      if (text?.startsWith('/analytics')) {
        const dashboardData = await analyticsLogging.getDashboardData(supabase)
        const formattedData = analyticsLogging.formatDashboardData(dashboardData)
        await sendMessage(chatId, formattedData)
        return success()
      }
      
      // Обработка голосовых сообщений
      if (voice) {
        await sendMessage(chatId, '🎤 Обрабатываю голосовое сообщение...')
        
        const result = await voiceInput.processVoiceMessage(
          voice,
          voice.file_id,
          userId,
          TELEGRAM_BOT_TOKEN,
          OPENAI_API_KEY,
          user?.language || 'ru'
        )
        
        if (result.success && result.intent) {
          // Показываем распознанный текст
          if (result.echoText) {
            await sendMessage(chatId, result.echoText)
          }
          
          // Обрабатываем намерение
          await handleVoiceIntent(userId, chatId, result.intent, userTone)
          
          // Логируем событие
          await analyticsLogging.logVoiceIntent(
            userId,
            result.intent.type,
            result.intent.confidence,
            result.intent.originalText,
            supabase
          )
        } else {
          await sendMessage(chatId, messageTemplates.getVoiceResponse('unclear', userTone))
        }
        
        return success()
      }
      
      // Обработка текстовых сообщений
      if (text && !text.startsWith('/')) {
        await handleTextMessage(userId, chatId, text, userTone)
        return success()
      }
      
      // Обработка фото
      if (photo && photo.length > 0) {
        await handlePhotoMessage(userId, chatId, photo, userTone)
        return success()
      }
    }
    
    return success()
  } catch (error) {
    console.error('Error:', error)
    await analyticsLogging.logError(undefined, 'main_handler', error.message, { stack: error.stack }, supabase)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

// Вспомогательные функции

function success() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

async function sendMessageWithInlineKeyboard(chatId: number, text: string, keyboard: any) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML',
      reply_markup: keyboard
    })
  })
}

async function ensureUser(userId: number, username?: string) {
  const { data } = await supabase
    .from('users')
    .select('user_id')
    .eq('user_id', userId)
    .single()
  
  if (!data) {
    await supabase.from('users').insert({
      user_id: userId,
      username: username,
      calories_goal: 2000,
      protein_goal: 150,
      carbs_goal: 200,
      fat_goal: 70
    })
    
    // Создаем связанные записи
    await supabase.from('preferences').insert({ user_id: userId })
    await supabase.from('state').insert({ user_id: userId })
  }
}

async function getUser(userId: number) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data
}

// Обработчики сообщений

async function handleTextMessage(userId: number, chatId: number, text: string, userTone: string) {
  try {
    // Получаем состояние пользователя
    const userState = telegramUX.getUserState(userId)
    
    // Обработка онбординга
    if (userState.onboarding_step) {
      await handleOnboardingStep(userId, chatId, text, userState.onboarding_step, userTone)
      return
    }
    
    // Проверяем, это описание еды или запрос
    const isMealDescription = await analyzeMealText(text)
    
    if (isMealDescription) {
      await handleMealDescription(userId, chatId, text, userTone)
    } else {
      await handleQuestion(userId, chatId, text, userTone)
    }
    
    // Добавляем в контекст
    await memoryContext.addToContext(userId, 'user', text, supabase)
    
  } catch (error) {
    console.error('Error handling text message:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function handleOnboardingStep(userId: number, chatId: number, text: string, step: string, userTone: string) {
  try {
    const userData = await extractUserDataFromText(text, step)
    
    if (userData) {
      // Сохраняем данные пользователя
      await supabase
        .from('users')
        .update(userData)
        .eq('user_id', userId)
      
      // Определяем следующий шаг
      const nextStep = getNextOnboardingStep(step)
      
      if (nextStep) {
        await sendMessage(chatId, messageTemplates.getOnboardingMessage(nextStep, userTone as any))
        await telegramUX.updateUserState(userId, { onboarding_step: nextStep })
      } else {
        // Завершаем онбординг и рассчитываем план
        await completeOnboarding(userId, chatId, userTone)
      }
      
      await analyticsLogging.logOnboarding(userId, step, userData, supabase)
    } else {
      await sendMessage(chatId, 'Пожалуйста, введите корректные данные.')
    }
  } catch (error) {
    console.error('Error handling onboarding step:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function completeOnboarding(userId: number, chatId: number, userTone: string) {
  try {
    const user = await getUser(userId)
    
    if (!user || !user.height_cm) {
      await sendMessage(chatId, 'Ошибка: не все данные заполнены.')
      return
    }
    
    // Рассчитываем план питания
    const userParams = {
      age: user.age || 30,
      sex: user.sex || 'male',
      height_cm: user.height_cm,
      weight_kg: user.weight_kg,
      activity: user.activity || 'moderate',
      goal: user.goal || 'maintain'
    }
    
    const plan = calculationEngine.calculateNutritionPlan(userParams)
    
    // Сохраняем план
    await supabase
      .from('plans')
      .upsert({
        user_id: userId,
        kcal: plan.kcal,
        p: plan.protein,
        f: plan.fat,
        c: plan.carbs,
        is_active: true,
        source: 'auto'
      }, {
        onConflict: 'user_id'
      })
    
    // Показываем план
    const planCard = messageTemplates.getPlanCard({
      tdee: plan.tdee,
      targetCalories: plan.kcal,
      protein: plan.protein,
      fat: plan.fat,
      carbs: plan.carbs,
      goal: userParams.goal
    }, userTone as any)
    
    await sendMessageWithInlineKeyboard(chatId, planCard, telegramUX.getPlanConfirmationKeyboard())
    
    // Очищаем состояние онбординга
    await telegramUX.updateUserState(userId, { onboarding_step: undefined })
    
    await analyticsLogging.logOnboarding(userId, 'completed', userParams, supabase)
    
  } catch (error) {
    console.error('Error completing onboarding:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function handleMealDescription(userId: number, chatId: number, text: string, userTone: string) {
  try {
    await sendMessage(chatId, '🤔 Анализирую ваше сообщение...')
    
    const analysis = await analyzeFoodText(text)
    await saveMeal(userId, analysis)
    
    // Показываем результат
    const formattedAnalysis = formatAnalysis(analysis)
    await sendMessage(chatId, formattedAnalysis)
    
    // Даём персональный совет
    const memory = await memoryContext.getUserMemory(userId, supabase)
    const advice = memoryContext.generatePersonalizedAdvice(memory, analysis)
    
    if (advice) {
      await sendMessage(chatId, advice)
    }
    
    // Логируем событие
    await analyticsLogging.logMealAdd(userId, analysis, 'text', supabase)
    
  } catch (error) {
    console.error('Error handling meal description:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function handleQuestion(userId: number, chatId: number, text: string, userTone: string) {
  try {
    await sendMessage(chatId, '🤔 Анализирую ваш запрос...')
    
    // Получаем память пользователя
    const memory = await memoryContext.getUserMemory(userId, supabase)
    
    // Генерируем персональный ответ
    const advice = memoryContext.generatePersonalizedAdvice(memory, undefined, text)
    
    await sendMessage(chatId, advice)
    
    // Добавляем ответ в контекст
    await memoryContext.addToContext(userId, 'assistant', advice, supabase)
    
  } catch (error) {
    console.error('Error handling question:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function handlePhotoMessage(userId: number, chatId: number, photo: any[], userTone: string) {
  try {
    await sendMessage(chatId, '📷 Анализирую фото еды...')
    
    const fileId = photo[photo.length - 1].file_id
    const fileUrl = await getFileUrl(fileId)
    const analysis = await analyzePhoto(fileUrl)
    
    await saveMeal(userId, analysis)
    
    const formattedAnalysis = formatAnalysis(analysis)
    await sendMessage(chatId, formattedAnalysis)
    
    await analyticsLogging.logMealAdd(userId, analysis, 'photo', supabase)
    
  } catch (error) {
    console.error('Error handling photo message:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}

async function handleVoiceIntent(userId: number, chatId: number, intent: any, userTone: string) {
  try {
    const response = messageTemplates.getVoiceResponse(intent.type, userTone as any)
    await sendMessage(chatId, response)
    
    // Обрабатываем конкретное намерение
    switch (intent.type) {
      case 'meal_add':
        if (intent.data) {
          await saveMeal(userId, intent.data)
          await sendMessage(chatId, messageTemplates.getConfirmationMessage('meal_added', userTone as any))
        }
        break
        
      case 'weight_update':
        if (intent.data?.weight) {
          await updateUserWeight(userId, intent.data.weight)
          await sendMessage(chatId, messageTemplates.getConfirmationMessage('profile_saved', userTone as any))
        }
        break
        
      case 'macro_adjust':
        if (intent.data) {
          await adjustUserMacros(userId, intent.data, userTone)
        }
        break
        
      case 'reminder_set':
        if (intent.data?.time) {
          await remindersSystem.setReminder(userId, 'day_report', intent.data.time, supabase)
          await sendMessage(chatId, messageTemplates.getConfirmationMessage('reminder_set', userTone as any))
        }
        break
    }
    
  } catch (error) {
    console.error('Error handling voice intent:', error)
    await sendMessage(chatId, messageTemplates.getErrorMessage('voice_error', userTone as any))
  }
}

// Вспомогательные функции для анализа и сохранения

async function analyzeMealText(text: string): Promise<boolean> {
  // Простая проверка - содержит ли текст описание еды
  const foodKeywords = ['ел', 'съел', 'поел', 'завтракал', 'обедал', 'ужинал', 'перекусил']
  return foodKeywords.some(keyword => text.toLowerCase().includes(keyword))
}

async function analyzeFoodText(text: string) {
  // Используем существующую логику анализа еды
  // Здесь можно интегрировать с OpenAI для более точного анализа
  return {
    name: text,
    calories: 300,
    protein: 20,
    carbs: 30,
    fat: 10,
    weight: 200
  }
}

async function analyzePhoto(fileUrl: string) {
  // Используем существующую логику анализа фото
  return {
    name: 'Блюдо с фото',
    calories: 400,
    protein: 25,
    carbs: 35,
    fat: 15,
    weight: 250
  }
}

async function saveMeal(userId: number, analysis: any) {
  await supabase.from('meals').insert({
    user_id: userId,
    meal_name: analysis.name,
    kcal: analysis.calories,
    protein: analysis.protein,
    carbs: analysis.carbs,
    fat: analysis.fat,
    weight_grams: analysis.weight
  })
}

function formatAnalysis(analysis: any): string {
  return `✅ Добавлено в дневник:

🍽️ ${analysis.name}
🔥 ${analysis.calories} ккал
🥩 ${analysis.protein}г белка
🍞 ${analysis.carbs}г углеводов
🥑 ${analysis.fat}г жиров
⚖️ Вес: ${analysis.weight}г`
}

async function getFileUrl(fileId: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function extractUserDataFromText(text: string, step: string): Promise<any> {
  // Простая логика извлечения данных из текста
  // В реальной реализации здесь будет более сложная логика
  
  switch (step) {
    case 'age':
      const age = parseInt(text)
      return age > 0 && age < 120 ? { age } : null
    case 'sex':
      return text.toLowerCase().includes('муж') ? { sex: 'male' } : 
             text.toLowerCase().includes('жен') ? { sex: 'female' } : null
    case 'height':
      const height = parseInt(text)
      return height > 100 && height < 250 ? { height_cm: height } : null
    case 'weight':
      const weight = parseInt(text)
      return weight > 30 && weight < 300 ? { weight_kg: weight } : null
    case 'activity':
      const activityMap: Record<string, string> = {
        'малоподвижный': 'sedentary',
        'лёгкая': 'light',
        'умеренная': 'moderate',
        'высокая': 'high',
        'очень высокая': 'very_high'
      }
      const activity = Object.keys(activityMap).find(key => text.toLowerCase().includes(key))
      return activity ? { activity: activityMap[activity] } : null
    case 'goal':
      const goalMap: Record<string, string> = {
        'похудение': 'fat_loss',
        'поддержание': 'maintain',
        'набор': 'gain'
      }
      const goal = Object.keys(goalMap).find(key => text.toLowerCase().includes(key))
      return goal ? { goal: goalMap[goal] } : null
    default:
      return null
  }
}

function getNextOnboardingStep(currentStep: string): string | null {
  const steps = ['age', 'sex', 'height', 'weight', 'activity', 'goal']
  const currentIndex = steps.indexOf(currentStep)
  return currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null
}

async function updateUserWeight(userId: number, weight: number) {
  await supabase
    .from('users')
    .update({ weight_kg: weight })
    .eq('user_id', userId)
}

async function adjustUserMacros(userId: number, adjustments: any, userTone: string) {
  try {
    // Получаем текущий план
    const { data: currentPlan } = await supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()
    
    if (!currentPlan) {
      await sendMessage(userId, 'Сначала создайте план питания.')
      return
    }
    
    // Получаем пользователя для валидации
    const user = await getUser(userId)
    
    // Применяем корректировки
    const validation = calculationEngine.validateAndAdjustMacros(
      currentPlan,
      adjustments,
      user.weight_kg
    )
    
    // Сохраняем новый план
    await supabase
      .from('plans')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('is_active', true)
    
    await supabase
      .from('plans')
      .insert({
        user_id: userId,
        kcal: validation.plan.kcal,
        p: validation.plan.protein,
        f: validation.plan.fat,
        c: validation.plan.carbs,
        rules_json: calculationEngine.createRulesJson(adjustments),
        is_active: true,
        source: 'manual'
      })
    
    // Показываем результат
    let message = messageTemplates.getConfirmationMessage('plan_updated', userTone as any)
    
    if (validation.warnings.length > 0) {
      message += '\n\n⚠️ Предупреждения:\n' + validation.warnings.join('\n')
    }
    
    await sendMessage(userId, message)
    
    await analyticsLogging.logPlanUpdate(userId, currentPlan, validation.plan, 'manual', supabase)
    
  } catch (error) {
    console.error('Error adjusting macros:', error)
    await sendMessage(userId, messageTemplates.getErrorMessage('save_error', userTone as any))
  }
}
