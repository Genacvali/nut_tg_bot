import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// Цены OpenAI API (за 1000 токенов)
const OPENAI_PRICES = {
  'gpt-4o': { input: 0.0025, output: 0.010 },        // $2.50/$10.00 per 1M tokens
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // $0.15/$0.60 per 1M tokens
  'whisper-1': 0.006 / 60                             // $0.006 per minute
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Функции для работы с контекстом разговора
async function addToContext(userId: number, role: 'user' | 'assistant', content: string) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('conversation_context')
      .eq('user_id', userId)
      .single()
    
    const context = user?.conversation_context || []
    
    // Добавляем новое сообщение
    context.push({
      role,
      content,
      timestamp: new Date().toISOString()
    })
    
    // Ограничиваем контекст последними 10 сообщениями
    const limitedContext = context.slice(-10)
    
    await supabase
      .from('users')
      .update({ conversation_context: limitedContext })
      .eq('user_id', userId)
      
  } catch (error) {
    console.error('Add context error:', error)
  }
}

async function getContext(userId: number) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('conversation_context')
      .eq('user_id', userId)
      .single()
    
    return user?.conversation_context || []
  } catch (error) {
    console.error('Get context error:', error)
    return []
  }
}

async function clearContext(userId: number) {
  try {
    await supabase
      .from('users')
      .update({ conversation_context: [] })
      .eq('user_id', userId)
  } catch (error) {
    console.error('Clear context error:', error)
  }
}

// Функция для отслеживания расходов на OpenAI
async function trackOpenAICost(userId: number, model: string, promptTokens: number, completionTokens: number, audioMinutes?: number) {
  try {
    let cost = 0
    
    if (model === 'whisper-1' && audioMinutes) {
      // Whisper оплачивается за минуты
      cost = audioMinutes * OPENAI_PRICES['whisper-1']
    } else if (model === 'gpt-4o') {
      // GPT-4o оплачивается за токены
      cost = (promptTokens / 1000) * OPENAI_PRICES['gpt-4o'].input +
             (completionTokens / 1000) * OPENAI_PRICES['gpt-4o'].output
    } else if (model === 'gpt-4o-mini') {
      // GPT-4o-mini оплачивается за токены
      cost = (promptTokens / 1000) * OPENAI_PRICES['gpt-4o-mini'].input +
             (completionTokens / 1000) * OPENAI_PRICES['gpt-4o-mini'].output
    }
    
    // Обновляем статистику пользователя
    const { data: user } = await supabase
      .from('users')
      .select('openai_cost_total, openai_requests_count')
      .eq('user_id', userId)
      .single()
    
    await supabase
      .from('users')
      .update({
        openai_cost_total: (user?.openai_cost_total || 0) + cost,
        openai_requests_count: (user?.openai_requests_count || 0) + 1,
        last_request_at: new Date().toISOString()
      })
      .eq('user_id', userId)
    
    console.log(`User ${userId}: +$${cost.toFixed(4)} (total: $${((user?.openai_cost_total || 0) + cost).toFixed(4)})`)
    
    // Предупреждение при превышении лимита
    const totalCost = (user?.openai_cost_total || 0) + cost
    if (totalCost > 5.0) {
      console.warn(`⚠️ User ${userId} exceeded $5 limit: $${totalCost.toFixed(2)}`)
    }
    
  } catch (error) {
    console.error('Track cost error:', error)
  }
}

// Wrapper для вызовов OpenAI с отслеживанием стоимости
async function callOpenAI(userId: number, requestBody: any) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  })
  
  const data = await response.json()
  
  // Отслеживаем расходы
  if (data.usage) {
    await trackOpenAICost(
      userId,
      requestBody.model,
      data.usage.prompt_tokens,
      data.usage.completion_tokens
    )
  }
  
  return data
}

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
      
      // Обработка редактирования блюда
      if (data.startsWith('edit_meal_')) {
        const mealId = data.replace('edit_meal_', '')
        await sendMessage(chatId, '✏️ Напишите правильное название блюда:\n\nНапример: "Треска с черникой и шпинатом"')
        
        // Сохраняем состояние редактирования
        await supabase.from('users').update({ 
          editing_meal_id: mealId 
        }).eq('user_id', userId)
        
        return success()
      }
      
      // Подтверждение блюда
      if (data === 'confirm_meal') {
        await sendMessageWithKeyboard(chatId, '✅ Отлично! Продолжайте в том же духе!', getMainKeyboard())
        return success()
      }
      
      // Обработка очистки статистики за сегодня
      if (data === 'clear_today_stats') {
        const today = new Date().toISOString().split('T')[0]
        const { error } = await supabase
          .from('meals')
          .delete()
          .eq('user_id', userId)
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`)
        
        if (error) {
          await sendMessage(chatId, '❌ Ошибка при очистке статистики')
        } else {
          await sendMessageWithKeyboard(chatId, '🗑️ Статистика за сегодня очищена!\n\nТеперь можете начать день с чистого листа.', getMainKeyboard())
        }
        return success()
      }
      
      // Обработка очистки всей статистики
      if (data === 'clear_all_stats') {
        const { error } = await supabase
          .from('meals')
          .delete()
          .eq('user_id', userId)
        
        if (error) {
          await sendMessage(chatId, '❌ Ошибка при очистке статистики')
        } else {
          await sendMessageWithKeyboard(chatId, '🗑️ Вся статистика питания очищена!\n\nВы можете начать отслеживание заново.', getMainKeyboard())
        }
        return success()
      }
      
      // Сохранение предложенных целей
      if (data === 'save_goals') {
        const { data: user } = await supabase
          .from('users')
          .select('temp_goals')
          .eq('user_id', userId)
          .single()
        
        if (user?.temp_goals) {
          const goals = user.temp_goals
          await supabase
            .from('users')
            .update({
              calories_goal: goals.calories,
              protein_goal: goals.protein,
              carbs_goal: goals.carbs,
              fat_goal: goals.fat,
              temp_goals: null
            })
            .eq('user_id', userId)
          
          await sendMessageWithKeyboard(chatId, 
            `✅ Цели сохранены!\n\n📊 Ваши новые цели:\n🔥 ${goals.calories} ккал\n🥩 ${goals.protein}г белка\n🍞 ${goals.carbs}г углеводов\n🥑 ${goals.fat}г жиров\n\nУдачи в достижении целей! 💪`, 
            getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Нет сохраненных целей для применения')
        }
        return success()
      }
      
      // Предложить свои цели
      if (data === 'suggest_own_goals') {
        await sendMessage(chatId, '✏️ Напишите свои цели в формате:\n\n"2500 ккал, 200г белка, 200г углеводов, 70г жиров"\n\nИли просто:\n"2500 калорий"\n\nИли голосом опишите что хотите изменить.')
        return success()
      }
      
      // Ручное редактирование КБЖУ
      if (data === 'edit_goals_manual') {
        await sendMessage(chatId, '✏️ Введите новые цели по КБЖУ:\n\n📝 Формат:\n"2500 ккал, 200г белка, 200г углеводов, 70г жиров"\n\n💡 Или можете указать только то, что хотите изменить:\n"2500 калорий"\n"200г белка"\n\n🎤 Также можете сказать голосом!')
        return success()
      }
      
      return success()
    }
    
    if (update.message) {
      const chatId = update.message.chat.id
      const userId = update.message.from.id
      const text = update.message.text
      const photo = update.message.photo
      
      // Обработка команд
      if (text?.startsWith('/start')) {
        await ensureUser(userId, update.message.from.username)
        const user = await getUser(userId)
        
        if (!user || !user.height) {
          // Первый запуск - запрашиваем параметры
          await sendMessage(chatId, getInitialSetupMessage())
        } else {
          // Пользователь уже настроен
          await sendMessageWithKeyboard(chatId, getWelcomeMessage(), getMainKeyboard())
        }
        return success()
      }
      
      if (text?.startsWith('/menu') || text?.startsWith('/help')) {
        await sendMessageWithKeyboard(chatId, getHelpMessage(), getMainKeyboard())
        return success()
      }
      
      // Обработка кнопок меню
      if (text === '📊 Статистика' || text?.startsWith('/stats')) {
        const stats = await getDailyStats(userId)
        await sendMessageWithKeyboard(chatId, stats, getMainKeyboard())
        return success()
      }
      
      if (text?.startsWith('/cost')) {
        const { data: user } = await supabase
          .from('users')
          .select('openai_cost_total, openai_requests_count, last_request_at')
          .eq('user_id', userId)
          .single()
        
        const costMessage = `💰 Статистика использования OpenAI API:

📊 Общая стоимость: $${(user?.openai_cost_total || 0).toFixed(4)}
🔢 Количество запросов: ${user?.openai_requests_count || 0}
⏰ Последний запрос: ${user?.last_request_at ? new Date(user.last_request_at).toLocaleString('ru-RU') : 'Нет данных'}

💡 Лимит: $5.00 на пользователя`
        
        await sendMessageWithKeyboard(chatId, costMessage, getMainKeyboard())
        return success()
      }
      
      if (text?.startsWith('/clear')) {
        await clearContext(userId)
        await sendMessageWithKeyboard(chatId, '🧹 Контекст разговора очищен! Теперь бот начнет диалог с чистого листа.', getMainKeyboard())
        return success()
      }
      
      if (text === '🥘 Что поесть?' || text?.startsWith('/recipe')) {
        await sendMessage(chatId, '🤔 Анализирую ваш рацион и подбираю рекомендации...')
        const advice = await getSmartAdvice(userId, 'что мне поесть сейчас?')
        await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
        return success()
      }
      
      if (text === '↩️ Отменить последнее' || text?.startsWith('/undo')) {
        const result = await undoLastMeal(userId)
        await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        return success()
      }
      
      if (text === '⚙️ Мои параметры' || text?.startsWith('/params')) {
        const user = await getUser(userId)
        if (user) {
          const paramsText = getUserParamsText(user)
          
          // Добавляем инлайн-кнопки для дополнительных действий
          const inlineKeyboard = {
            inline_keyboard: [[
              { text: '✏️ Редактировать КБЖУ', callback_data: 'edit_goals_manual' },
            ], [
              { text: '🗑️ Очистить статистику за сегодня', callback_data: 'clear_today_stats' },
            ], [
              { text: '🗑️ Очистить всю статистику', callback_data: 'clear_all_stats' }
            ]]
          }
          
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: paramsText,
              reply_markup: inlineKeyboard
            })
          })
        } else {
          await sendMessage(chatId, '❌ Сначала используйте /start')
        }
        return success()
      }
      
      // Команда для изменения целей по КБЖУ
      if (text?.startsWith('/setgoals ')) {
        const goalsText = text.replace('/setgoals ', '')
        const result = await updateUserGoals(userId, goalsText)
        await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        return success()
      }
      
      // Команда для быстрого изменения калорий
      if (text?.startsWith('/calories ')) {
        const calories = parseInt(text.replace('/calories ', ''))
        if (calories && calories > 500 && calories < 10000) {
          await supabase
            .from('users')
            .update({ calories_goal: calories })
            .eq('user_id', userId)
          
          await sendMessageWithKeyboard(chatId, `✅ Цель по калориям обновлена: ${calories} ккал/день`, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите корректное количество калорий: /calories 2500')
        }
        return success()
      }
      
      // Синхронизация данных Apple Watch / Apple Health
      if (text?.startsWith('/sync_weight ')) {
        const weight = parseFloat(text.split(' ')[1])
        if (weight && weight > 30 && weight < 300) {
          await syncHealthData(userId, 'weight', weight)
          await sendMessageWithKeyboard(chatId, `✅ Вес записан: ${weight} кг\n\n⌚ Используйте Apple Shortcuts для автоматической синхронизации!`, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите корректный вес: /sync_weight 75.5')
        }
        return success()
      }

      if (text?.startsWith('/sync_steps ')) {
        const steps = parseInt(text.split(' ')[1])
        if (steps && steps > 0 && steps < 100000) {
          await syncHealthData(userId, 'steps', steps)
          let message = `✅ Шаги записаны: ${steps.toLocaleString()} 👟`
          
          // Мотивация в зависимости от количества шагов
          if (steps >= 15000) {
            message += `\n\n🔥 Отлично! Это высокая активность!\nДобавил +300 ккал к вашей дневной норме.`
          } else if (steps >= 10000) {
            message += `\n\n👍 Хорошо! Цель 10000 шагов достигнута!`
          } else if (steps >= 5000) {
            message += `\n\n💪 Неплохо, но давайте стремиться к 10000!`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите количество шагов: /sync_steps 12000')
        }
        return success()
      }

      if (text?.startsWith('/sync_sleep ')) {
        const sleep = parseFloat(text.split(' ')[1])
        if (sleep && sleep > 0 && sleep < 24) {
          await syncHealthData(userId, 'sleep_hours', sleep)
          let message = `✅ Сон записан: ${sleep}ч 🛌`
          
          // Советы в зависимости от продолжительности сна
          if (sleep < 6) {
            message += `\n\n⚠️ Мало сна! Организм в стрессе.\nДобавил +200 ккал к норме для восстановления.`
          } else if (sleep >= 7 && sleep <= 9) {
            message += `\n\n✅ Идеальный сон! Отлично для восстановления!`
          } else if (sleep > 9) {
            message += `\n\n😴 Много сна - возможно, нужен отдых?`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите часы сна: /sync_sleep 7.5')
        }
        return success()
      }

      if (text?.startsWith('/sync_calories ')) {
        const calories = parseInt(text.split(' ')[1])
        if (calories && calories > 0 && calories < 5000) {
          await syncHealthData(userId, 'active_calories', calories)
          let message = `✅ Активность записана: ${calories} ккал 🔥`
          
          if (calories >= 500) {
            message += `\n\n💪 Интенсивная тренировка!\nДобавил ${calories} ккал к вашей дневной норме.`
          } else if (calories >= 300) {
            message += `\n\n👍 Хорошая активность!`
          }
          
          await sendMessageWithKeyboard(chatId, message, getMainKeyboard())
        } else {
          await sendMessage(chatId, '❌ Укажите сожженные калории: /sync_calories 450')
        }
        return success()
      }
      
      // Анализ текста
      if (text && !text.startsWith('/')) {
        // Проверяем, редактирует ли пользователь блюдо
        const { data: userData } = await supabase
          .from('users')
          .select('editing_meal_id')
          .eq('user_id', userId)
          .single()
        
        if (userData?.editing_meal_id) {
          // Обновляем название блюда
          await supabase
            .from('meals')
            .update({ meal_name: text })
            .eq('id', userData.editing_meal_id)
          
          // Очищаем состояние редактирования
          await supabase
            .from('users')
            .update({ editing_meal_id: null })
            .eq('user_id', userId)
          
          await sendMessageWithKeyboard(chatId, `✅ Название обновлено!\n\n🍽️ ${text}\n\nТеперь данные сохранены правильно.`, getMainKeyboard())
          return success()
        }
        
        // Проверяем, это параметры пользователя или цель
        const isUserParams = (text.toLowerCase().includes('рост') && text.toLowerCase().includes('вес')) ||
                            text.toLowerCase().includes('пересоберем') ||
                            text.toLowerCase().includes('пересчитаем') ||
                            text.toLowerCase().includes('калораж') ||
                            text.toLowerCase().includes('параметры') ||
                            text.toLowerCase().includes('записать') ||
                            text.toLowerCase().includes('обнови') ||
                            text.toLowerCase().includes('измени') ||
                            text.toLowerCase().includes('заново') ||
                            (text.toLowerCase().includes('похудеть') && text.toLowerCase().includes('кг')) ||
                            (text.toLowerCase().includes('похудеть') && text.toLowerCase().includes('вес')) ||
                            (text.match(/\d+\s*(см|м|метр)/i) && text.match(/\d+\s*кг/i))
        
        // Проверяем, хочет ли пользователь изменить цели КБЖУ
        const isGoalChange = text.toLowerCase().includes('хочу') && (
          text.toLowerCase().includes('калори') ||
          text.toLowerCase().includes('белк') ||
          text.toLowerCase().includes('углевод') ||
          text.toLowerCase().includes('жир') ||
          text.toLowerCase().includes('цель') ||
          text.toLowerCase().includes('норм')
        ) || text.match(/\d+\s*(ккал|калори|белк|углевод|жир)/i)
        
        // Проверяем согласие на предложенные БЖУ
        const isAcceptBJU = text.toLowerCase().includes('да') || 
                           text.toLowerCase().includes('установи бжу') ||
                           text.toLowerCase().includes('согласен') ||
                           text.toLowerCase().includes('хорошо')
        
        // Проверяем, рассказывает ли о предпочтениях в еде
        const isFoodPreferences = text.toLowerCase().includes('люблю') ||
                                 text.toLowerCase().includes('нравится') ||
                                 text.toLowerCase().includes('ем') ||
                                 text.toLowerCase().includes('предпочитаю') ||
                                 text.toLowerCase().includes('обожаю')
        
        if (isAcceptBJU) {
          // Устанавливаем предложенные БЖУ
          const { data: user } = await supabase
            .from('users')
            .select('calories_goal')
            .eq('user_id', userId)
            .single()
          
          if (user?.calories_goal) {
            const calories = user.calories_goal
            const protein = Math.round(calories * 0.25 / 4)
            const carbs = Math.round(calories * 0.45 / 4)
            const fat = Math.round(calories * 0.30 / 9)
            
            await supabase
              .from('users')
              .update({ 
                protein_goal: protein,
                carbs_goal: carbs,
                fat_goal: fat
              })
              .eq('user_id', userId)
            
            await sendMessageWithKeyboard(chatId, 
              `✅ Отлично! Установил сбалансированные пропорции:\n\n` +
              `🔥 Калории: ${calories}\n` +
              `🥩 Белки: ${protein}г (25%)\n` +
              `🍞 Углеводы: ${carbs}г (45%)\n` +
              `🥑 Жиры: ${fat}г (30%)\n\n` +
              `Теперь у вас полноценный план! Хотите составить меню на день? 🍽️\n\n` +
              `${calculateWaterRecommendation(user, null)}`, 
              getMainKeyboard())
          }
        } else if (isFoodPreferences) {
          // Составляем персональный план на основе предпочтений
          await sendMessage(chatId, '🍽️ Отлично! Составляю персональный план питания...')
          const mealPlan = await generatePersonalMealPlan(userId, text)
          const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('user_id', userId)
            .single()
          const waterRec = calculateWaterRecommendation(user, null)
          await sendMessageWithKeyboard(chatId, mealPlan + '\n\n' + waterRec, getMainKeyboard())
        } else if (isGoalChange) {
          // Пользователь хочет изменить цели
          await sendMessage(chatId, '🎯 Обновляю ваши цели по КБЖУ...')
          const result = await updateUserGoals(userId, text)
          await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        } else if (isUserParams) {
          // Обновляем параметры пользователя
          await sendMessage(chatId, '📝 Обновляю ваши параметры и цели...')
          const result = await updateUserParams(userId, text)
          await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
        } else {
          // Проверяем, спрашивает ли пользователь совет
          const isQuestion = text.toLowerCase().includes('что') || 
                            text.toLowerCase().includes('посоветуй') ||
                            text.toLowerCase().includes('предложи') ||
                            text.toLowerCase().includes('?') ||
                            text.toLowerCase().includes('хочу') ||
                            text.toLowerCase().includes('можно') ||
                            text.toLowerCase().includes('рекомендуй') ||
                            text.toLowerCase().includes('совет') ||
                            text.toLowerCase().includes('помоги') ||
                            text.toLowerCase().includes('что-то') ||
                            text.toLowerCase().includes('ничего') ||
                            text.toLowerCase().includes('порекомендуй') ||
                            text.toLowerCase().includes('что бы') ||
                            text.toLowerCase().includes('что мне') ||
                            text.toLowerCase().includes('не знаю') ||
                            text.toLowerCase().includes('выбор') ||
                            text.toLowerCase().includes('вариант')
          
          if (isQuestion) {
            // Даем совет или рецепт
            await sendMessage(chatId, '🤔 Анализирую ваш рацион и подбираю рекомендации...')
            
            // Сохраняем вопрос пользователя в контекст
            await addToContext(userId, 'user', text)
            
            const advice = await getSmartAdvice(userId, text)
            
            // Сохраняем ответ бота в контекст
            await addToContext(userId, 'assistant', advice)
            
            await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
          } else {
            // Обычный анализ еды
            await sendMessage(chatId, '🤔 Анализирую ваше сообщение...')
            const analysis = await analyzeFoodText(text)
            await saveMeal(userId, analysis)
            
            // Даем анализ + совет
            const advice = await getAdviceAfterMeal(userId, analysis)
            await sendMessageWithKeyboard(chatId, formatAnalysis(analysis) + '\n\n' + advice, getMainKeyboard())
          }
        }
        return success()
      }
      
      // Анализ фото
      if (photo && photo.length > 0) {
        await sendMessage(chatId, '📷 Анализирую фото еды...')
        const fileId = photo[photo.length - 1].file_id
        const fileUrl = await getFileUrl(fileId)
        const analysis = await analyzePhoto(fileUrl)
        
        // Сохраняем meal_id для возможности редактирования
        const { data: mealData } = await supabase.from('meals').insert({
          user_id: userId,
          meal_name: analysis.name,
          calories: analysis.calories,
          protein: analysis.protein,
          carbs: analysis.carbs,
          fat: analysis.fat,
          protein_percent: analysis.protein_percent,
          carbs_percent: analysis.carbs_percent,
          fat_percent: analysis.fat_percent,
          weight_grams: analysis.weight
        }).select('id').single()
        
        const mealId = mealData?.id
        
        // Добавляем кнопки для редактирования
        const editKeyboard = {
          inline_keyboard: [[
            { text: '✏️ Исправить', callback_data: `edit_meal_${mealId}` },
            { text: '✅ Верно', callback_data: 'confirm_meal' }
          ]]
        }
        
        await sendMessageWithInlineKeyboard(chatId, formatAnalysis(analysis) + '\n\n💡 Если название неверное - нажмите "Исправить"', editKeyboard)
        return success()
      }
      
      // Анализ голоса
      if (update.message.voice) {
        await sendMessage(chatId, '🎤 Обрабатываю голосовое сообщение...')
        const fileId = update.message.voice.file_id
        const fileUrl = await getFileUrl(fileId)
        const text = await transcribeVoice(fileUrl)
        
        if (text) {
          await sendMessage(chatId, `📝 Распознано: ${text}`)
          
          // Проверяем, это запрос на обновление параметров
          const isUserParams = (text.toLowerCase().includes('рост') && text.toLowerCase().includes('вес')) ||
                              text.toLowerCase().includes('пересоберем') ||
                              text.toLowerCase().includes('пересчитаем') ||
                              text.toLowerCase().includes('калораж') ||
                              text.toLowerCase().includes('параметры') ||
                              text.toLowerCase().includes('записать') ||
                              text.toLowerCase().includes('обнови') ||
                              text.toLowerCase().includes('измени') ||
                              text.toLowerCase().includes('заново') ||
                              (text.toLowerCase().includes('похудеть') && text.toLowerCase().includes('кг')) ||
                              (text.toLowerCase().includes('похудеть') && text.toLowerCase().includes('вес')) ||
                              (text.match(/\d+\s*(см|м|метр)/i) && text.match(/\d+\s*кг/i))
          
          // Проверяем, это критика/обсуждение целей (продолжение диалога)
          const isGoalDiscussion = !isUserParams && (
                                   text.toLowerCase().includes('много') ||
                                   text.toLowerCase().includes('мало') ||
                                   text.toLowerCase().includes('высокий') ||
                                   text.toLowerCase().includes('низкий') ||
                                   text.toLowerCase().includes('пересмотр')
                                  ) && (
                                   text.toLowerCase().includes('калори') ||
                                   text.toLowerCase().includes('белк') ||
                                   text.toLowerCase().includes('углевод') ||
                                   text.toLowerCase().includes('жир') ||
                                   text.toLowerCase().includes('кбжу')
                                  )
          
          // Проверяем, это запрос на совет или описание еды
          const isAdviceRequest = !isUserParams && !isGoalDiscussion && (
                                 text.toLowerCase().includes('что') || 
                                 text.toLowerCase().includes('хочу') ||
                                 text.toLowerCase().includes('можно') ||
                                 text.toLowerCase().includes('рекомендуй') ||
                                 text.toLowerCase().includes('совет') ||
                                 text.toLowerCase().includes('помоги') ||
                                 text.toLowerCase().includes('что-то') ||
                                 text.toLowerCase().includes('ничего') ||
                                 text.toLowerCase().includes('порекомендуй') ||
                                 text.toLowerCase().includes('что бы') ||
                                 text.toLowerCase().includes('что мне')
                               )
          
          if (isUserParams) {
            // Это запрос на обновление параметров
            await sendMessage(chatId, '📝 Обновляю ваши параметры и цели...')
            const result = await updateUserParams(userId, text)
            await sendMessageWithKeyboard(chatId, result, getMainKeyboard())
          } else if (isGoalDiscussion) {
            // Это обсуждение целей - используем контекст
            await sendMessage(chatId, '🤔 Анализирую ваш запрос и корректирую цели...')
            
            // Сохраняем критику пользователя в контекст
            await addToContext(userId, 'user', text)
            
            const advice = await getSmartAdvice(userId, text)
            
            // Извлекаем и сохраняем предложенные цели временно
            const tempGoals = await extractAndSaveTempGoals(userId, advice)
            
            // Сохраняем ответ бота в контекст
            await addToContext(userId, 'assistant', advice)
            
            // Если есть предложенные цели - добавляем кнопку "Сохранить"
            if (tempGoals) {
              const saveKeyboard = {
                inline_keyboard: [[
                  { text: '✅ Сохранить эти цели', callback_data: 'save_goals' },
                  { text: '✏️ Предложить свои', callback_data: 'suggest_own_goals' }
                ]]
              }
              
              await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: advice,
                  reply_markup: saveKeyboard
                })
              })
            } else {
              await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
            }
          } else if (isAdviceRequest) {
            // Это запрос на совет - даем рекомендации
            await sendMessage(chatId, '🤔 Анализирую ваш рацион и подбираю рекомендации...')
            
            // Сохраняем вопрос пользователя в контекст
            await addToContext(userId, 'user', text)
            
            const advice = await getSmartAdvice(userId, text)
            
            // Сохраняем ответ бота в контекст
            await addToContext(userId, 'assistant', advice)
            
            await sendMessageWithKeyboard(chatId, advice, getMainKeyboard())
          } else {
            // Это описание еды - анализируем и сохраняем
            const analysis = await analyzeFoodText(text)
            await saveMeal(userId, analysis)
            await sendMessage(chatId, formatAnalysis(analysis))
            
            // Даем совет после еды
            const advice = await getAdviceAfterMeal(userId, analysis)
            if (advice) {
              await sendMessage(chatId, advice)
            }
          }
        } else {
          await sendMessage(chatId, '❌ Не удалось распознать голосовое сообщение')
        }
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

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

async function sendMessageWithKeyboard(chatId: number, text: string, keyboard: any) {
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

async function sendMessageWithInlineKeyboard(chatId: number, text: string, inlineKeyboard: any) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text,
      reply_markup: inlineKeyboard
    })
  })
}

function getMainKeyboard() {
  return {
    keyboard: [
      [
        { text: '📊 Статистика' },
        { text: '🥘 Что поесть?' }
      ],
      [
        { text: '⚙️ Мои параметры' },
        { text: '↩️ Отменить последнее' }
      ]
    ],
    resize_keyboard: true,
    persistent: true
  }
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
  }
}

async function analyzeFoodText(text: string) {
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
            role: 'system',
            content: `Ты эксперт-нутрициолог. Твоя задача - точно определить КБЖУ из описания еды.

ВАЖНО:
- Если указан вес/граммовка - используй его
- Если нет - оцени стандартную порцию
- Учитывай способ приготовления (жареное +масло, вареное без масла)
- Суммируй все продукты в одном приеме пищи
- Будь внимателен к деталям: "с маслом", "острый", "жареный"
- Рассчитай соотношения БЖУ в процентах от калорий

ПРИМЕРЫ:
"яичница из 2 яиц" → 2 яйца ~100г, жареные на масле ~200 ккал
"тарелка борща" → ~300г, ~150 ккал
"гречка с курицей" → гречка 150г + курица 100г = ~350 ккал

ФОРМАТ ОТВЕТА (только JSON, без комментариев):
{"name": "детальное название", "calories": число, "protein": число, "carbs": число, "fat": число, "weight": число, "protein_percent": число, "carbs_percent": число, "fat_percent": число}`
          },
          { 
            role: 'user', 
            content: `Что я съел и какое КБЖУ? "${text}"` 
          }
        ],
        max_tokens: 300,
        temperature: 0.5
      })
    })
    
    const data = await response.json()
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid OpenAI response')
    }
    
    let content = data.choices[0].message.content
    
    // Убираем markdown если есть
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    // Пытаемся распарсить JSON
    try {
      const parsed = JSON.parse(content)
      // Валидация и округление данных
      return {
        name: parsed.name || 'Прием пищи',
        calories: Math.round(parsed.calories || 0),
        protein: Math.round((parsed.protein || 0) * 10) / 10,
        carbs: Math.round((parsed.carbs || 0) * 10) / 10,
        fat: Math.round((parsed.fat || 0) * 10) / 10,
        weight: Math.round(parsed.weight || 100),
        protein_percent: Math.round((parsed.protein_percent || 0) * 10) / 10,
        carbs_percent: Math.round((parsed.carbs_percent || 0) * 10) / 10,
        fat_percent: Math.round((parsed.fat_percent || 0) * 10) / 10
      }
    } catch (jsonError) {
      // Если не JSON, пытаемся извлечь данные из текста
      console.error('JSON parse error:', jsonError, 'Content:', content)
      return parseTextResponse(content)
    }
  } catch (error) {
    console.error('Analysis error:', error)
    return {
      name: 'Неизвестное блюдо',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      weight: 100
    }
  }
}

function parseTextResponse(text: string) {
  // Простой парсер для извлечения чисел из текста
  const numbers = text.match(/\d+\.?\d*/g) || []
  const calories = parseInt(numbers[0] || '0') || 0
  const protein = parseFloat(numbers[1] || '0') || 0
  const carbs = parseFloat(numbers[2] || '0') || 0
  const fat = parseFloat(numbers[3] || '0') || 0
  
  // Рассчитываем проценты
  const proteinCalories = protein * 4
  const carbsCalories = carbs * 4
  const fatCalories = fat * 9
  
  return {
    name: 'Анализ блюда',
    calories: calories,
    protein: protein,
    carbs: carbs,
    fat: fat,
    weight: parseInt(numbers[4] || '100') || 100,
    protein_percent: calories > 0 ? Math.round((proteinCalories / calories) * 100 * 10) / 10 : 0,
    carbs_percent: calories > 0 ? Math.round((carbsCalories / calories) * 100 * 10) / 10 : 0,
    fat_percent: calories > 0 ? Math.round((fatCalories / calories) * 100 * 10) / 10 : 0
  }
}

async function analyzePhoto(fileUrl: string) {
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
            role: 'system',
            content: `Ты эксперт-нутрициолог, который анализирует фотографии еды.

ТВОЯ ЗАДАЧА:
1. Внимательно рассмотри фото и определи ВСЕ продукты и блюда на нем
2. Оцени примерный вес/объем каждого компонента
3. Рассчитай общее КБЖУ для ВСЕЙ порции на фото (не на 100г!)
4. Рассчитай соотношения БЖУ в процентах от калорий
5. Дай подробное описание

ВАЖНО:
- Указывай РЕАЛЬНЫЙ вес порции в граммах (например, тарелка супа ~300г, котлета ~100г)
- Если несколько блюд - считай общее КБЖУ
- Учитывай способ приготовления (жареное, вареное, запеченное)
- Будь внимателен к соусам, маслу, добавкам
- Рассчитай процентное соотношение БЖУ
- НЕ ПРИДУМЫВАЙ продукты! Если видишь рыбу - пиши рыбу, если видишь ягоды - пиши ягоды

ПРИМЕРЫ ПРАВИЛЬНОГО ОПИСАНИЯ:
- "Треска жареная с черникой и шпинатом" (НЕ "пельмени")
- "Куриная грудка с рисом и овощами" (НЕ просто "мясо")
- "Овсянка с бананом и орехами" (НЕ просто "каша")

ФОРМАТ ОТВЕТА (только JSON, без markdown):
{"name": "подробное название", "calories": число, "protein": число, "carbs": число, "fat": число, "weight": число, "protein_percent": число, "carbs_percent": число, "fat_percent": число}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Проанализируй эту еду детально. Что именно здесь на фото? Назови каждый продукт отдельно. Сколько примерно весит вся порция? Какое КБЖУ для всей порции?'
              },
              {
                type: 'image_url',
                image_url: { 
                  url: fileUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    })
    
    const data = await response.json()
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid OpenAI response')
    }
    
    let content = data.choices[0].message.content
    
    // Убираем markdown если есть
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    try {
      const parsed = JSON.parse(content)
      
      // Валидация названия блюда - проверяем на разумность
      const name = parsed.name || 'Блюдо с фото'
      const suspiciousNames = ['пельмени', 'борщ', 'суп', 'каша', 'мясо', 'рыба']
      const hasSuspiciousName = suspiciousNames.some(suspicious => 
        name.toLowerCase().includes(suspicious) && name.split(' ').length <= 2
      )
      
      if (hasSuspiciousName) {
        console.log('Suspicious name detected, asking for clarification:', name)
        // Если название слишком общее, добавляем пометку
        parsed.name = name + ' (требует уточнения)'
      }
      
      // Валидация данных
      return {
        name: parsed.name,
        calories: Math.round(parsed.calories || 0),
        protein: Math.round((parsed.protein || 0) * 10) / 10,
        carbs: Math.round((parsed.carbs || 0) * 10) / 10,
        fat: Math.round((parsed.fat || 0) * 10) / 10,
        weight: Math.round(parsed.weight || 100),
        protein_percent: Math.round((parsed.protein_percent || 0) * 10) / 10,
        carbs_percent: Math.round((parsed.carbs_percent || 0) * 10) / 10,
        fat_percent: Math.round((parsed.fat_percent || 0) * 10) / 10
      }
    } catch (jsonError) {
      console.error('JSON parse error:', jsonError, 'Content:', content)
      return parseTextResponse(content)
    }
  } catch (error) {
    console.error('Photo analysis error:', error)
    return {
      name: 'Неизвестное блюдо с фото',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      weight: 100
    }
  }
}

async function getFileUrl(fileId: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await response.json()
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`
}

async function transcribeVoice(fileUrl: string) {
  try {
    // Скачиваем аудио файл
    const audioResponse = await fetch(fileUrl)
    const audioBlob = await audioResponse.blob()
    
    // Создаем FormData для Whisper API
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    })
    
    const data = await response.json()
    return data.text || null
  } catch (error) {
    console.error('Transcription error:', error)
    return null
  }
}

async function saveMeal(userId: number, analysis: any) {
  await supabase.from('meals').insert({
    user_id: userId,
    meal_name: analysis.name,
    calories: analysis.calories,
    protein: analysis.protein,
    carbs: analysis.carbs,
    fat: analysis.fat,
    protein_percent: analysis.protein_percent,
    carbs_percent: analysis.carbs_percent,
    fat_percent: analysis.fat_percent,
    weight_grams: analysis.weight
  })
}

async function getDailyStats(userId: number) {
  const today = new Date().toISOString().split('T')[0]
  
  const { data: meals } = await supabase
    .from('meals')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`)
  
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  // Получаем данные Apple Watch
  const healthData = await getHealthData(userId)
  
  if (!meals || meals.length === 0) {
    let message = '📊 Сегодня еще нет записей о еде.'
    
    // Показываем данные Apple Watch даже если еды нет
    if (healthData) {
      message += `\n\n⌚ Данные Apple Watch:`
      if (healthData.steps) message += `\n👟 Шаги: ${healthData.steps.toLocaleString()}`
      if (healthData.sleep_hours) message += `\n🛌 Сон: ${healthData.sleep_hours}ч`
      if (healthData.active_calories) message += `\n🔥 Активность: ${healthData.active_calories} ккал`
      if (healthData.weight) message += `\n⚖️ Вес: ${healthData.weight} кг`
    }
    
    return message
  }
  
  const total = meals.reduce((acc, meal) => ({
    calories: acc.calories + meal.calories,
    protein: acc.protein + meal.protein,
    carbs: acc.carbs + meal.carbs,
    fat: acc.fat + meal.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  
  // Рассчитываем скорректированную норму калорий
  const baseCalories = user?.calories_goal || 2000
  const adjustedCalories = calculateAdjustedCalories(baseCalories, healthData)
  
  let caloriesText = `🔥 Калории: ${total.calories} / ${baseCalories}`
  if (adjustedCalories !== baseCalories) {
    caloriesText += ` (+${adjustedCalories - baseCalories} за активность)`
  }
  
  let message = `📊 Статистика за сегодня:

${caloriesText}
🥩 Белки: ${total.protein.toFixed(1)}г / ${user?.protein_goal || 150}г
🍞 Углеводы: ${total.carbs.toFixed(1)}г / ${user?.carbs_goal || 200}г
🥑 Жиры: ${total.fat.toFixed(1)}г / ${user?.fat_goal || 70}г

📝 Приемов пищи: ${meals.length}`

  // Добавляем детальный анализ КБЖУ
  const avgProteinPercent = meals.reduce((sum, meal) => sum + (meal.protein_percent || 0), 0) / meals.length
  const avgCarbsPercent = meals.reduce((sum, meal) => sum + (meal.carbs_percent || 0), 0) / meals.length
  const avgFatPercent = meals.reduce((sum, meal) => sum + (meal.fat_percent || 0), 0) / meals.length
  
  message += `\n\n📊 Соотношение БЖУ за день:`
  message += `\n🥩 Белки: ${avgProteinPercent.toFixed(1)}%`
  message += `\n🍞 Углеводы: ${avgCarbsPercent.toFixed(1)}%`
  message += `\n🥑 Жиры: ${avgFatPercent.toFixed(1)}%`
  
  // Анализ баланса
  let balanceAdvice = ''
  if (avgProteinPercent < 20) {
    balanceAdvice += `\n⚠️ Мало белка! Добавьте мясо, рыбу, творог`
  }
  if (avgCarbsPercent > 60) {
    balanceAdvice += `\n⚠️ Много углеводов! Больше овощей`
  }
  if (avgFatPercent < 15) {
    balanceAdvice += `\n⚠️ Мало жиров! Орехи, масло, авокадо`
  }
  
  if (balanceAdvice) {
    message += `\n\n💡 Советы:${balanceAdvice}`
  }

  // Добавляем данные Apple Watch
  if (healthData) {
    message += `\n\n⌚ Данные Apple Watch:`
    if (healthData.steps) {
      const emoji = healthData.steps >= 10000 ? '✅' : healthData.steps >= 5000 ? '👍' : '💪'
      message += `\n${emoji} Шаги: ${healthData.steps.toLocaleString()}`
    }
    if (healthData.sleep_hours) {
      const emoji = healthData.sleep_hours >= 7 ? '✅' : healthData.sleep_hours >= 6 ? '😴' : '⚠️'
      message += `\n${emoji} Сон: ${healthData.sleep_hours}ч`
    }
    if (healthData.active_calories) {
      message += `\n🔥 Активность: ${healthData.active_calories} ккал`
    }
    if (healthData.weight) {
      message += `\n⚖️ Вес: ${healthData.weight} кг`
    }
    
    message += `\n\n💡 Синхронизация:\n/sync_weight • /sync_steps • /sync_sleep • /sync_calories`
  } else {
    message += `\n\n⌚ Подключите Apple Watch:\n/sync_weight 75.5 • /sync_steps 12000`
  }
  
  // Добавляем рекомендации по воде
  const waterRecommendation = calculateWaterRecommendation(user, healthData)
  if (waterRecommendation) {
    message += `\n\n${waterRecommendation}`
  }
  
  return message
}

function getGoalsMessage(userId: number) {
  return `🎯 Управление целями по КБЖУ:

Используйте команды:
/setgoals - изменить цели
/today - прогресс за сегодня`
}

function formatAnalysis(analysis: any) {
  let message = `✅ Добавлено в дневник:

🍽️ ${analysis.name}
🔥 ${analysis.calories} ккал
🥩 ${analysis.protein}г белка
🍞 ${analysis.carbs}г углеводов
🥑 ${analysis.fat}г жиров
⚖️ Вес: ${analysis.weight}г`

  // Добавляем соотношения БЖУ
  if (analysis.protein_percent && analysis.carbs_percent && analysis.fat_percent) {
    message += `\n\n📊 Соотношение БЖУ:`
    message += `\n🥩 Белки: ${analysis.protein_percent}%`
    message += `\n🍞 Углеводы: ${analysis.carbs_percent}%`
    message += `\n🥑 Жиры: ${analysis.fat_percent}%`
    
    // Анализ баланса блюда
    let balanceAdvice = ''
    if (analysis.protein_percent < 15) {
      balanceAdvice += `\n⚠️ Мало белка в этом блюде`
    } else if (analysis.protein_percent > 40) {
      balanceAdvice += `\n💪 Отличный источник белка!`
    }
    
    if (analysis.carbs_percent > 70) {
      balanceAdvice += `\n⚠️ Много углеводов`
    }
    
    if (analysis.fat_percent < 10) {
      balanceAdvice += `\n⚠️ Мало жиров`
    } else if (analysis.fat_percent > 50) {
      balanceAdvice += `\n⚠️ Много жиров`
    }
    
    if (balanceAdvice) {
      message += `\n\n💡 Анализ:${balanceAdvice}`
    }
  }

  return message
}

function getHelpMessage() {
  return `🍎 Помощь по боту-нутрициологу:

📝 Отправьте текст: "Я ел борщ и хлеб"
📷 Отправьте фото еды для анализа
🎤 Отправьте голосовое сообщение

Команды:
/start - Начать работу с ботом
/menu - Главное меню с кнопками
/help - Показать эту справку
/stats - Показать статистику за сегодня
/goals - Настроить цели по КБЖУ
/recipe - Предложить рецепт
/undo - Удалить последний прием пищи

Вечером в 21:00 я автоматически пришлю отчет!`
}

async function undoLastMeal(userId: number) {
  try {
    const { data: lastMeal } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    if (!lastMeal) {
      return '❌ Нет приемов пищи для удаления'
    }
    
    await supabase
      .from('meals')
      .delete()
      .eq('id', lastMeal.id)
    
    return `✅ Удалено: ${lastMeal.meal_name} (${lastMeal.calories} ккал)`
  } catch (error) {
    console.error('Undo error:', error)
    return '❌ Ошибка при удалении'
  }
}

async function getRecipeSuggestion(userId: number) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) {
      return '❌ Сначала используйте /start'
    }
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
    
    const total = meals?.reduce((acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + meal.protein,
      carbs: acc.carbs + meal.carbs,
      fat: acc.fat + meal.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    const prompt = `Предложи простой рецепт блюда, которое:
- Содержит примерно ${remaining.calories} ккал (можно меньше)
- Белка: ${remaining.protein.toFixed(1)}г
- Углеводов: ${remaining.carbs.toFixed(1)}г
- Жиров: ${remaining.fat.toFixed(1)}г

Формат ответа:
🍽️ Название блюда

Ингредиенты:
- список ингредиентов

Приготовление:
краткое описание

КБЖУ на порцию: XXX ккал, XXг/XXг/XXг

💧 ВОДА: ${Math.round(user.calories_goal * 0.4)}мл в день (0.4мл на ккал)`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Ты опытный нутрициолог и повар. Предлагай простые и вкусные рецепты.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    })
    
    const data = await response.json()
    const recipe = data.choices?.[0]?.message?.content || 'Не удалось получить рецепт'
    
    return `🥘 Рецепт на основе ваших целей:\n\nОсталось до цели: ${remaining.calories} ккал\n\n${recipe}`
  } catch (error) {
    console.error('Recipe error:', error)
    return '❌ Ошибка при получении рецепта. Попробуйте позже.'
  }
}

async function getAdviceAfterMeal(userId: number, meal: any) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) return ''
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
    
    const total = meals?.reduce((acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    let advice = '💡 Совет:\n'
    
    if (remaining.calories < 0) {
      advice += `⚠️ Превышение по калориям на ${Math.abs(remaining.calories)} ккал. Будьте осторожны до конца дня!`
    } else if (remaining.calories < 500) {
      advice += `✅ Осталось ${remaining.calories} ккал до цели. Хороший прогресс!`
    } else {
      advice += `📊 Осталось ${remaining.calories} ккал. `
      
      if (remaining.protein > 30) {
        advice += `Не хватает белка (${remaining.protein.toFixed(0)}г) - добавьте курицу, творог или яйца. `
      }
      if (remaining.carbs < 50 && remaining.protein < 20) {
        advice += `Можете добавить легкий перекус с углеводами.`
      }
    }
    
    // Добавляем рекомендации по воде
    advice += `\n\n💧 ВОДА: ${Math.round(user.calories_goal * 0.4)}мл в день (0.4мл на ккал)`
    
    return advice
  } catch (error) {
    console.error('Advice error:', error)
    return ''
  }
}

async function updateUserParams(userId: number, text: string) {
  try {
    const prompt = `Извлеки параметры пользователя из текста: "${text}"

Найди:
- Рост в см (например: "метр девяносто три", "193 см", "сто девяносто три")
- Вес в кг (например: "сто десять", "110 кг", "сто десять килограмм")
- Цель (сбросить/набрать вес)
- Количество кг для сброса/набора (например: "хочу вес где-то девяносто восемь" = сбросить до 98кг)
- Активность (зал, тренировки, спорт, силовые)
  * "high" - если тренируется 3+ раза в неделю или "два-три раза в неделю"
  * "medium" - если тренируется 1-2 раза в неделю
  * "low" - если не тренируется или редко
- Возраст (если указан)

ВАЖНО: Учитывай разговорную речь и числительные словами!

Ответь ТОЛЬКО в JSON:
{
  "height": число_см,
  "weight": число_кг,
  "goal": "lose" или "gain",
  "target_weight": число_кг,
  "activity": "high" или "medium" или "low",
  "age": число_лет_или_null
}

Если чего-то нет, поставь null.`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Ты извлекаешь параметры пользователя из текста. Отвечай СТРОГО в формате JSON без markdown блоков. Просто чистый JSON объект.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200
      })
    })
    
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    
    if (!content) {
      console.error('Empty content from OpenAI')
      return '❌ Не удалось обработать параметры. Попробуйте еще раз.'
    }
    
    // Очищаем JSON от markdown блоков
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    console.log('Parsing params:', cleanContent)
    const params = JSON.parse(cleanContent)
    
    // Вычисляем цели по КБЖУ на основе параметров
    const goals = calculateNutritionGoals(params)
    
    // Обновляем пользователя в базе
    await supabase
      .from('users')
      .update({
        height: params.height,
        weight: params.weight,
        goal: params.goal,
        target_weight: params.target_weight,
        activity: params.activity,
        calories_goal: goals.calories,
        protein_goal: goals.protein,
        carbs_goal: goals.carbs,
        fat_goal: goals.fat
      })
      .eq('user_id', userId)
    
    // Генерируем план рациона
    const mealPlan = await generateMealPlan(params, goals)
    
    return `✅ Отлично! Я составил ваш персональный план!

📋 Ваши параметры:
📏 Рост: ${params.height} см
⚖️ Вес: ${params.weight} кг
🎯 Цель: ${params.goal === 'lose' ? 'Сбросить' : params.goal === 'gain' ? 'Набрать' : 'Поддержать'} ${params.target_weight ? Math.abs(params.target_weight - params.weight) + ' кг' : 'вес'}
🏋️ Активность: ${params.activity === 'high' ? 'Высокая (зал 3-5 раз)' : params.activity === 'medium' ? 'Средняя (1-2 раза)' : 'Низкая'}

📊 Ваши цели на день:
🔥 Калории: ${goals.calories}
🥩 Белки: ${goals.protein}г
🍞 Углеводы: ${goals.carbs}г
🥑 Жиры: ${goals.fat}г

${mealPlan}

Готово! Теперь просто отправляйте мне что едите, и я буду следить за вашим прогрессом! 🎯`
  } catch (error) {
    console.error('Update params error:', error)
    return '❌ Не удалось обновить параметры. Попробуйте еще раз.'
  }
}

async function generateMealPlan(params: any, goals: any) {
  try {
    const goalText = params.goal === 'lose' ? 'похудение' : params.goal === 'gain' ? 'набор массы' : 'поддержание веса'
    
    const prompt = `Составь примерный план рациона на день для человека:
- Вес: ${params.weight}кг
- Цель: ${goalText}
- Активность: ${params.activity === 'high' ? 'высокая (тренировки)' : 'средняя'}
- Калории: ${goals.calories}
- Белки: ${goals.protein}г
- Углеводы: ${goals.carbs}г
- Жиры: ${goals.fat}г

Формат ответа (БЕЗ markdown, только эмодзи и текст):

🍽️ ПРИМЕРНЫЙ ПЛАН РАЦИОНА:

🌅 Завтрак (7:00-9:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

🥗 Обед (13:00-14:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

🍖 Ужин (19:00-20:00)
• [простое блюдо]
• КБЖУ: XXX ккал, XXб/XXу/XXж

💡 Совет: [короткий совет по питанию]`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Ты опытный нутрициолог. Составляй простые и реалистичные планы питания. НЕ используй markdown.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    })
    
    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (error) {
    console.error('Meal plan error:', error)
    return `🍽️ ПРИМЕРНЫЙ ПЛАН РАЦИОНА:

🌅 Завтрак: Овсянка с фруктами, яйца
🥗 Обед: Курица с рисом и овощами
🍖 Ужин: Рыба с салатом

Я буду помогать вам следовать этому плану!`
  }
}

function calculateNutritionGoals(params: any) {
  // Базовый метаболизм (формула Миффлина-Сан Жеора)
  let bmr = 10 * params.weight + 6.25 * params.height - 5 * 30 + 5 // мужчина 30 лет
  
  // Коэффициент активности
  let activityMultiplier = 1.2
  if (params.activity === 'high') activityMultiplier = 1.7
  else if (params.activity === 'medium') activityMultiplier = 1.5
  
  let calories = Math.round(bmr * activityMultiplier)
  
  // Корректировка на цель
  if (params.goal === 'lose') {
    calories -= 500 // дефицит для похудения
  } else if (params.goal === 'gain') {
    calories += 300 // профицит для набора
  }
  
  // Макросы
  const protein = Math.round(params.weight * 2.2) // 2.2г на кг веса для тренирующихся
  const carbs = Math.round(calories * 0.4 / 4) // 40% от калорий
  const fat = Math.round(calories * 0.25 / 9) // 25% от калорий
  
  return { calories, protein, carbs, fat }
}

// Функция для извлечения и сохранения предложенных целей (временно)
async function extractAndSaveTempGoals(userId: number, advice: string): Promise<any | null> {
  try {
    // Ищем новые цели в ответе
    const caloriesMatch = advice.match(/🔥 Калории:\s*(\d+)/i)
    const proteinMatch = advice.match(/🥩 Белки:\s*(\d+)/i)
    const carbsMatch = advice.match(/🍞 Углеводы:\s*(\d+)/i)
    const fatMatch = advice.match(/🥑 Жиры:\s*(\d+)/i)
    
    if (caloriesMatch || proteinMatch || carbsMatch || fatMatch) {
      const tempGoals: any = {}
      
      if (caloriesMatch) tempGoals.calories = parseInt(caloriesMatch[1])
      if (proteinMatch) tempGoals.protein = parseInt(proteinMatch[1])
      if (carbsMatch) tempGoals.carbs = parseInt(carbsMatch[1])
      if (fatMatch) tempGoals.fat = parseInt(fatMatch[1])
      
      // Сохраняем во временное хранилище
      await supabase
        .from('users')
        .update({ temp_goals: tempGoals })
        .eq('user_id', userId)
      
      console.log(`Saved temp goals for user ${userId}:`, tempGoals)
      return tempGoals
    }
    return null
  } catch (error) {
    console.error('Extract goals error:', error)
    return null
  }
}

async function getSmartAdvice(userId: number, question: string) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) {
      return '❌ Сначала используйте /start'
    }
    
    // Получаем контекст разговора
    const context = await getContext(userId)
    
    const today = new Date().toISOString().split('T')[0]
    const { data: meals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`)
    
    const mealsList = meals?.map(m => `${m.meal_name} (${m.calories} ккал, ${m.protein}г белка)`).join(', ') || 'ничего'
    
    const total = meals?.reduce((acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }
    
    const remaining = {
      calories: user.calories_goal - total.calories,
      protein: user.protein_goal - total.protein,
      carbs: user.carbs_goal - total.carbs,
      fat: user.fat_goal - total.fat
    }
    
    const userInfo = user.height ? `Пользователь: ${user.height}см, ${user.weight}кг, цель ${user.goal === 'lose' ? 'сбросить' : 'набрать'} вес` : ''
    
    // Формируем контекст для промпта
    const contextText = context.length > 0 ? 
      `\n\nКОНТЕКСТ РАЗГОВОРА (последние сообщения):\n${context.map(c => `${c.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${c.content}`).join('\n')}` : ''
    
    const prompt = `Ты нутрициолог в Telegram. Пользователь спрашивает: "${question}"

${userInfo}

Сегодня он уже ел: ${mealsList}
Съедено: ${total.calories} ккал, ${total.protein.toFixed(0)}г белка, ${total.carbs.toFixed(0)}г углеводов, ${total.fat.toFixed(0)}г жиров

Цели на день: ${user.calories_goal} ккал, ${user.protein_goal}г белка, ${user.carbs_goal}г углеводов, ${user.fat_goal}г жиров

Осталось до цели: ${remaining.calories} ккал, ${remaining.protein.toFixed(0)}г белка${contextText}

ВАЖНО: 
- Учитывай контекст предыдущих сообщений
- Если пользователь критикует предложенные ранее цели (например: "много углеводов", "высокий калораж") - предложи КОНКРЕТНЫЕ скорректированные цели
- Форматирование для Telegram (без markdown)
- Короткие абзацы

Если пользователь критикует цели, дай ответ в таком формате:

✅ Вы правы! Давайте скорректируем ваши цели:

📊 НОВЫЕ ЦЕЛИ:
🔥 Калории: [новое значение] (было ${user.calories_goal})
🥩 Белки: [новое значение]г (было ${user.protein_goal}г)
🍞 Углеводы: [новое значение]г (было ${user.carbs_goal}г)
🥑 Жиры: [новое значение]г (было ${user.fat_goal}г)

💡 Почему эти цели лучше:
[объяснение]

🍽️ Примеры блюд с новыми целями:
• Завтрак: [пример]
• Обед: [пример]
• Ужин: [пример]

Если это обычный вопрос, дай совет в стандартном формате с вариантами блюд.

💧 ВОДА: ${Math.round(user.calories_goal * 0.4)}мл в день (0.4мл на ккал)`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Ты опытный и дружелюбный нутрициолог. Даешь персональные советы по питанию.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600
      })
    })
    
    const data = await response.json()
    const advice = data.choices?.[0]?.message?.content || 'Не удалось получить совет'
    
    const progressText = `📊 Прогресс за сегодня:
🔥 Калории: ${total.calories} из ${user.calories_goal}
🥩 Белки: ${total.protein.toFixed(0)}г из ${user.protein_goal}г
🍞 Углеводы: ${total.carbs.toFixed(0)}г из ${user.carbs_goal}г
🥑 Жиры: ${total.fat.toFixed(0)}г из ${user.fat_goal}г

Осталось до цели: ${remaining.calories} ккал

---

${advice}`
    
    return progressText
  } catch (error) {
    console.error('Smart advice error:', error)
    return '❌ Ошибка при получении совета. Попробуйте позже.'
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

function getInitialSetupMessage() {
  return `🍎 Добро пожаловать в AI бота-нутрициолога!

Я ваш персональный помощник в питании. Помогу:
✅ Отслеживать КБЖУ из текста, фото и голоса
✅ Анализировать ваш рацион
✅ Предлагать рецепты под ваши цели
✅ Составлять план питания
✅ Отправлять ежедневные отчеты

Для персонализированных рекомендаций расскажите о себе:

📏 Рост (в см)
⚖️ Текущий вес (в кг)
🎯 Цель (сбросить/набрать/поддержать вес)
📊 На сколько кг (если худеете/набираете)
🏋️ Уровень активности (зал 3-5 раз/неделя, тренировки 1-2 раза, малоподвижный)
👤 Возраст (опционально)

Пример:
"Мне 30 лет, рост 180см, вешу 85кг, хочу сбросить 10кг, хожу в зал 4 раза в неделю"

После этого я составлю персональный план рациона и рассчитаю ваши цели по КБЖУ!

⚠️ Важно: Вся аналитика примерная!
Точный расчет КБЖУ возможен только при указании точных граммовок продуктов.

Расскажите о себе одним сообщением:`
}

function getUserParamsText(user: any) {
  const goalText = user.goal === 'lose' ? 'Сбросить' : user.goal === 'gain' ? 'Набрать' : 'Поддержать'
  const activityText = user.activity === 'high' ? 'Высокая (зал)' : 
                      user.activity === 'medium' ? 'Средняя' : 'Низкая'
  
  return `⚙️ Ваши параметры:

📏 Рост: ${user.height || 'не указан'} см
⚖️ Вес: ${user.weight || 'не указан'} кг
🎯 Цель: ${goalText} ${user.target_weight ? Math.abs(user.target_weight - user.weight) : ''} кг
🏋️ Активность: ${activityText}

📊 Текущие цели на день:
🔥 Калории: ${user.calories_goal}
🥩 Белки: ${user.protein_goal}г
🍞 Углеводы: ${user.carbs_goal}г
🥑 Жиры: ${user.fat_goal}г

💡 Чтобы изменить параметры, просто напишите новые данные одним сообщением.

🎯 Команды для изменения целей:
• /calories 9000 - изменить калории
• /setgoals 2500 ккал, 150г белка, 200г углеводов, 70г жиров

⚠️ Помните: аналитика примерная!
Для точного расчета указывайте граммовки продуктов.`
}

function getWelcomeMessage() {
  return `🍎 Добро пожаловать в AI бота-нутрициолога!

Я ваш персональный помощник по питанию с искусственным интеллектом!

🎯 ЧТО Я УМЕЮ:

📊 Анализирую еду:
• Текст: "Я ел гречку с курицей"
• Фото: отправьте фото блюда
• Голос: запишите что ели
→ Сразу даю КБЖУ и советы

🥘 Помогаю с питанием:
• "Что поесть?" → предложу 2-3 варианта под ваши цели
• Рассчитываю персональные нормы КБЖУ
• Составляю план рациона на день
• Предупреждаю о переедании/недоедании

📈 Отслеживаю прогресс:
• Статистика за день (📊 кнопка)
• Ежедневные отчеты в 21:00
• Напоминания о приемах пищи

⌚ Интеграция Apple Watch:
• Синхронизация веса, шагов, сна
• Автокорректировка целей по активности
• Учет сожженных калорий

⚙️ Настройки:
• Укажите параметры (рост, вес, цель)
• Я рассчитаю вашу норму калорий
• Посмотреть параметры: кнопка ⚙️

💡 КАК ПОЛЬЗОВАТЬСЯ:

1️⃣ Расскажите о себе один раз:
"Я 180см, вешу 80кг, хочу сбросить 10кг, хожу в зал"

2️⃣ Записывайте еду любым способом:
"Позавтракал овсянкой и яйцами"
[фото еды]
[голосовое сообщение]

3️⃣ Спрашивайте совет:
"Что мне поесть?"
"Посоветуй рецепт"

4️⃣ Используйте кнопки внизу для быстрого доступа

⚠️ Важно: Аналитика примерная!
Точный КБЖУ только при указании граммовок.

Готовы начать? Расскажите о себе! 🚀`
}

// ⌚ Функции для работы с Apple Watch / Apple Health

async function syncHealthData(userId: number, field: string, value: number) {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    // Проверяем есть ли запись за сегодня
    const { data: existing } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
    if (existing) {
      // Обновляем существующую запись
      await supabase
        .from('health_data')
        .update({ [field]: value })
        .eq('user_id', userId)
        .eq('date', today)
    } else {
      // Создаем новую запись
      await supabase
        .from('health_data')
        .insert({
          user_id: userId,
          date: today,
          [field]: value
        })
    }
  } catch (error) {
    console.error('Sync health data error:', error)
  }
}

async function getHealthData(userId: number) {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    const { data } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle()
    
    return data
  } catch (error) {
    return null
  }
}

function calculateAdjustedCalories(baseCalories: number, healthData: any): number {
  let adjusted = baseCalories
  
  // Добавляем калории за высокую активность (шаги)
  if (healthData?.steps && healthData.steps >= 15000) {
    adjusted += 300
  } else if (healthData?.steps && healthData.steps >= 12000) {
    adjusted += 200
  }
  
  // Добавляем калории за недосып (стресс организма)
  if (healthData?.sleep_hours && healthData.sleep_hours < 6) {
    adjusted += 200
  }
  
  // Добавляем сожженные калории с тренировок
  if (healthData?.active_calories) {
    adjusted += healthData.active_calories
  }
  
  return adjusted
}

async function updateUserGoals(userId: number, goalsText: string) {
  try {
    // Парсим цели из текста - более гибкие паттерны
    const caloriesMatch = goalsText.match(/(\d+)\s*(ккал|калори|ккал\/день)/i)
    const proteinMatch = goalsText.match(/(\d+)\s*(г\s*)?(белк|протеин)/i)
    const carbsMatch = goalsText.match(/(\d+)\s*(г\s*)?(углевод|карб)/i)
    const fatMatch = goalsText.match(/(\d+)\s*(г\s*)?(жир)/i)
    
    // Дополнительные паттерны для естественной речи
    const caloriesAltMatch = goalsText.match(/(\d+)\s*(в день|на день|калорий)/i)
    const proteinAltMatch = goalsText.match(/белк[а-я]*\s*(\d+)/i)
    const carbsAltMatch = goalsText.match(/углевод[а-я]*\s*(\d+)/i)
    const fatAltMatch = goalsText.match(/жир[а-я]*\s*(\d+)/i)
    
    const calories = caloriesMatch ? parseInt(caloriesMatch[1]) : 
                    caloriesAltMatch ? parseInt(caloriesAltMatch[1]) : null
    const protein = proteinMatch ? parseInt(proteinMatch[1]) : 
                   proteinAltMatch ? parseInt(proteinAltMatch[1]) : null
    const carbs = carbsMatch ? parseInt(carbsMatch[1]) : 
                 carbsAltMatch ? parseInt(carbsAltMatch[1]) : null
    const fat = fatMatch ? parseInt(fatMatch[1]) : 
               fatAltMatch ? parseInt(fatAltMatch[1]) : null
    
    if (!calories && !protein && !carbs && !fat) {
      return '❌ Не удалось распознать цели. Попробуйте:\n\n"Хочу 9000 калорий в день"\n"Установи 150г белка"\n"Норма 2500 ккал, 200г углеводов"'
    }
    
    // Обновляем только указанные цели
    const updateData: any = {}
    if (calories) updateData.calories_goal = calories
    if (protein) updateData.protein_goal = protein
    if (carbs) updateData.carbs_goal = carbs
    if (fat) updateData.fat_goal = fat
    
    await supabase
      .from('users')
      .update(updateData)
      .eq('user_id', userId)
    
    let message = '✅ Цели обновлены:\n\n'
    if (calories) message += `🔥 Калории: ${calories}\n`
    if (protein) message += `🥩 Белки: ${protein}г\n`
    if (carbs) message += `🍞 Углеводы: ${carbs}г\n`
    if (fat) message += `🥑 Жиры: ${fat}г\n`
    
    // Если изменили только калории, предлагаем БЖУ
    if (calories && !protein && !carbs && !fat) {
      const suggestedProtein = Math.round(calories * 0.25 / 4) // 25% от калорий
      const suggestedCarbs = Math.round(calories * 0.45 / 4)  // 45% от калорий
      const suggestedFat = Math.round(calories * 0.30 / 9)    // 30% от калорий
      
      message += `\n💡 Предлагаю БЖУ для ${calories} ккал:\n`
      message += `🥩 Белки: ${suggestedProtein}г (25%)\n`
      message += `🍞 Углеводы: ${suggestedCarbs}г (45%)\n`
      message += `🥑 Жиры: ${suggestedFat}г (30%)\n\n`
      message += `Хотите установить эти пропорции? Напишите "да" или "установи БЖУ"\n\n`
      message += `Или скажите что любите есть - я составлю персональный план! 🍽️\n\n`
      message += `💧 И не забывайте пить воду! Рекомендую ${Math.round(calories * 0.4)}мл в день (0.4мл на ккал)`
    }
    
    return message
  } catch (error) {
    console.error('Update goals error:', error)
    return '❌ Ошибка при обновлении целей'
  }
}

function calculateWaterRecommendation(user: any, healthData: any): string {
  if (!user) return ''
  
  // Базовая норма: 35мл на кг веса
  const baseWater = Math.round((user.weight || 70) * 35)
  
  // Корректировки
  let adjustments: string[] = []
  let totalWater = baseWater
  
  // Активность
  if (healthData?.steps && healthData.steps >= 15000) {
    totalWater += 500
    adjustments.push('+500мл за высокую активность')
  } else if (healthData?.steps && healthData.steps >= 10000) {
    totalWater += 300
    adjustments.push('+300мл за активность')
  }
  
  // Тренировки
  if (healthData?.active_calories && healthData.active_calories >= 500) {
    totalWater += 400
    adjustments.push('+400мл за тренировку')
  }
  
  // Жаркая погода (примерно)
  const currentHour = new Date().getHours()
  if (currentHour >= 10 && currentHour <= 18) {
    totalWater += 200
    adjustments.push('+200мл за дневное время')
  }
  
  // Недосып
  if (healthData?.sleep_hours && healthData.sleep_hours < 6) {
    totalWater += 300
    adjustments.push('+300мл за недосып')
  }
  
  let message = `💧 Рекомендация по воде: ${totalWater}мл`
  
  if (adjustments.length > 0) {
    message += `\n\n📊 Корректировки:\n${adjustments.join('\n')}`
  }
  
  // Советы по времени питья
  message += `\n\n⏰ Схема питья:\n`
  message += `• Утром: ${Math.round(totalWater * 0.3)}мл (30%)\n`
  message += `• Днем: ${Math.round(totalWater * 0.4)}мл (40%)\n`
  message += `• Вечером: ${Math.round(totalWater * 0.3)}мл (30%)`
  
  return message
}

async function generatePersonalMealPlan(userId: number, preferences: string) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (!user) return '❌ Сначала настройте параметры'
    
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
            role: 'system',
            content: `Ты персональный нутрициолог. Составляешь план питания на основе предпочтений пользователя.

ЦЕЛИ ПОЛЬЗОВАТЕЛЯ:
- Калории: ${user.calories_goal}
- Белки: ${user.protein_goal}г
- Углеводы: ${user.carbs_goal}г  
- Жиры: ${user.fat_goal}г
- Цель: ${user.goal === 'lose' ? 'сбросить вес' : user.goal === 'gain' ? 'набрать вес' : 'поддержать вес'}

ПРЕДПОЧТЕНИЯ: ${preferences}

Составь план на день с учетом предпочтений. Укажи точные граммовки и КБЖУ каждого блюда.

ФОРМАТ:
🌅 ЗАВТРАК: [название] - [граммовки] = [КБЖУ]
☀️ ОБЕД: [название] - [граммовки] = [КБЖУ]  
🌆 УЖИН: [название] - [граммовки] = [КБЖУ]
🍎 ПЕРЕКУСЫ: [название] - [граммовки] = [КБЖУ]

ИТОГО: [общее КБЖУ]

💧 ВОДА: ${Math.round(user.calories_goal * 0.4)}мл в день (0.4мл на ккал)

Не используй markdown!`
          },
          {
            role: 'user',
            content: `Составь мне план питания на день с учетом моих предпочтений: ${preferences}`
          }
        ],
        max_tokens: 800,
        temperature: 0.7
      })
    })
    
    const data = await response.json()
    return data.choices[0].message.content
  } catch (error) {
    console.error('Personal meal plan error:', error)
    return '❌ Ошибка при составлении плана питания'
  }
}
