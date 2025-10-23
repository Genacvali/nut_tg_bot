// Планировщик напоминаний (cron job)
// Запускается каждую минуту для проверки и отправки напоминаний

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Типы для типизации
interface Reminder {
  id: number;
  user_id: number;
  kind: 'day_report' | 'meal' | 'weigh';
  time_local: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface User {
  user_id: number;
  tz: string;
  language: string;
  tone: 'coach' | 'mentor' | 'neutral';
}

interface DailyTotals {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

interface NutritionPlan {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

interface DayReport {
  date: string;
  totals: DailyTotals;
  plan: NutritionPlan;
  meals: Array<{
    name: string;
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    meal_type?: string;
  }>;
  advice: string;
  user: User;
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Функции для работы с напоминаниями

/**
 * Получение активных напоминаний для текущего времени
 */
async function getActiveRemindersForNow(supabase: any): Promise<Reminder[]> {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM
  
  try {
    const { data: reminders, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('is_enabled', true)
      .eq('time_local', currentTime);
    
    if (error) {
      console.error('Error fetching reminders:', error);
      return [];
    }
    
    return reminders || [];
  } catch (error) {
    console.error('Error in getActiveRemindersForNow:', error);
    return [];
  }
}

/**
 * Получение данных пользователя для отчёта
 */
async function getUserDataForReport(userId: number, supabase: any): Promise<{
  user: User;
  plan: NutritionPlan;
  totals: DailyTotals;
  meals: any[];
} | null> {
  try {
    // Получаем пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_id, tz, language, tone')
      .eq('user_id', userId)
      .single();
    
    if (userError || !user) {
      console.error('User not found:', userError);
      return null;
    }
    
    // Получаем активный план
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('kcal, p, f, c')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    
    if (planError || !plan) {
      console.error('Plan not found:', planError);
      return null;
    }
    
    // Получаем дневные итоги
    const today = new Date().toISOString().split('T')[0];
    const { data: totals, error: totalsError } = await supabase
      .from('daily_totals')
      .select('kcal, p, f, c')
      .eq('user_id', userId)
      .eq('date', today)
      .single();
    
    // Получаем приёмы пищи за день
    const { data: meals, error: mealsError } = await supabase
      .from('meals')
      .select('meal_name, kcal, protein, fat, carbs, meal_type')
      .eq('user_id', userId)
      .gte('ts', `${today}T00:00:00`)
      .lte('ts', `${today}T23:59:59`)
      .order('ts', { ascending: true });
    
    return {
      user,
      plan: {
        kcal: plan.kcal,
        protein: plan.p,
        fat: plan.f,
        carbs: plan.c
      },
      totals: totals || { kcal: 0, p: 0, f: 0, c: 0 },
      meals: meals?.map(meal => ({
        name: meal.meal_name,
        calories: meal.kcal,
        protein: meal.protein,
        fat: meal.fat,
        carbs: meal.carbs,
        meal_type: meal.meal_type
      })) || []
    };
  } catch (error) {
    console.error('Error getting user data for report:', error);
    return null;
  }
}

/**
 * Генерация персонального совета
 */
function generatePersonalAdvice(
  totals: DailyTotals, 
  plan: NutritionPlan, 
  tone: 'coach' | 'mentor' | 'neutral'
): string {
  const caloriesDiff = totals.kcal - plan.kcal;
  const proteinDiff = totals.p - plan.protein;
  const fatDiff = totals.f - plan.fat;
  const carbsDiff = totals.c - plan.carbs;
  
  const advice: string[] = [];
  
  // Анализ калорий
  if (caloriesDiff > 200) {
    advice.push('Превышение по калориям. Завтра уменьшите порции.');
  } else if (caloriesDiff < -300) {
    advice.push('Недостаток калорий. Добавьте полезный перекус.');
  } else if (Math.abs(caloriesDiff) < 100) {
    advice.push('Отличный баланс калорий!');
  }
  
  // Анализ белков
  if (proteinDiff < -20) {
    advice.push('Добавьте белок: курица, рыба, творог, яйца.');
  } else if (proteinDiff > 30) {
    advice.push('Много белка - отлично для мышц!');
  }
  
  // Анализ жиров
  if (fatDiff < -15) {
    advice.push('Не хватает жиров. Орехи, авокадо, масло.');
  }
  
  // Анализ углеводов
  if (carbsDiff < -50) {
    advice.push('Мало углеводов. Добавьте крупы, фрукты.');
  } else if (carbsDiff > 100) {
    advice.push('Много углеводов. Больше овощей и белка.');
  }
  
  // Тон совета
  if (tone === 'coach') {
    return advice.length > 0 ? advice.join(' ') : 'Продолжайте в том же духе! 💪';
  } else if (tone === 'mentor') {
    return advice.length > 0 ? advice.join(' ') : 'Хорошая работа! 🎯';
  } else {
    return advice.length > 0 ? advice.join(' ') : 'Баланс соблюден. 📊';
  }
}

/**
 * Форматирование отчёта для отправки
 */
function formatDayReport(report: DayReport, user: User): string {
  const { totals, plan, meals, advice } = report;
  
  // Рассчитываем прогресс
  const caloriesProgress = Math.round((totals.kcal / plan.kcal) * 100);
  const proteinProgress = Math.round((totals.p / plan.protein) * 100);
  const fatProgress = Math.round((totals.f / plan.fat) * 100);
  const carbsProgress = Math.round((totals.c / plan.carbs) * 100);
  
  // Эмодзи для прогресса
  const getProgressEmoji = (progress: number) => {
    if (progress >= 100) return '✅';
    if (progress >= 80) return '👍';
    if (progress >= 60) return '📊';
    return '⚠️';
  };
  
  // Тон сообщения
  const tonePrefix = {
    coach: '💪',
    mentor: '🎯',
    neutral: '📊'
  }[user.tone];
  
  let message = `${tonePrefix} ИТОГ ДНЯ ${report.date}

📊 ПРОГРЕСС:
${getProgressEmoji(caloriesProgress)} Калории: ${totals.kcal} / ${plan.kcal} (${caloriesProgress}%)
${getProgressEmoji(proteinProgress)} Белки: ${totals.p}г / ${plan.protein}г (${proteinProgress}%)
${getProgressEmoji(fatProgress)} Жиры: ${totals.f}г / ${plan.fat}г (${fatProgress}%)
${getProgressEmoji(carbsProgress)} Углеводы: ${totals.c}г / ${plan.carbs}г (${carbsProgress}%)

🍽️ ПРИЁМЫ ПИЩИ (${meals.length}):`;
  
  // Добавляем приёмы пищи
  meals.forEach((meal, index) => {
    const mealEmoji = getMealEmoji(meal.meal_type);
    message += `\n${mealEmoji} ${meal.name}: ${meal.calories} ккал`;
  });
  
  // Добавляем совет
  message += `\n\n💡 СОВЕТ:\n${advice}`;
  
  return message;
}

/**
 * Получение эмодзи для типа приёма пищи
 */
function getMealEmoji(mealType?: string): string {
  switch (mealType) {
    case 'breakfast': return '🌅';
    case 'lunch': return '☀️';
    case 'dinner': return '🌆';
    case 'snack': return '🍎';
    default: return '🍽️';
  }
}

/**
 * Отправка отчёта пользователю
 */
async function sendDayReport(
  userId: number, 
  report: DayReport, 
  botToken: string
): Promise<boolean> {
  try {
    const message = formatDayReport(report, report.user);
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    return true;
  } catch (error) {
    console.error('Error sending day report:', error);
    return false;
  }
}

/**
 * Отправка напоминания о приёме пищи
 */
async function sendMealReminder(
  userId: number, 
  botToken: string, 
  userTone: 'coach' | 'mentor' | 'neutral'
): Promise<boolean> {
  try {
    const messages = {
      coach: '💪 Время поесть! Не забывайте про белок!',
      mentor: '🍽️ Пора подкрепиться. Что планируете съесть?',
      neutral: '🍽️ Время приёма пищи.'
    };
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: messages[userTone]
      })
    });
    
    return true;
  } catch (error) {
    console.error('Error sending meal reminder:', error);
    return false;
  }
}

/**
 * Отправка напоминания о взвешивании
 */
async function sendWeighReminder(
  userId: number, 
  botToken: string, 
  userTone: 'coach' | 'mentor' | 'neutral'
): Promise<boolean> {
  try {
    const messages = {
      coach: '⚖️ Время взвешивания! Записывайте вес для отслеживания прогресса!',
      mentor: '📊 Пора взвеситься. Это поможет отследить динамику.',
      neutral: '⚖️ Напоминание о взвешивании.'
    };
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: messages[userTone]
      })
    });
    
    return true;
  } catch (error) {
    console.error('Error sending weigh reminder:', error);
    return false;
  }
}

/**
 * Главная функция обработки напоминаний
 */
async function processReminders(
  supabase: any, 
  botToken: string
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  
  try {
    // Получаем активные напоминания
    const reminders = await getActiveRemindersForNow(supabase);
    
    for (const reminder of reminders) {
      try {
        // Получаем данные пользователя
        const userData = await getUserDataForReport(reminder.user_id, supabase);
        
        if (!userData) {
          errors++;
          continue;
        }
        
        // Отправляем соответствующее уведомление
        let success = false;
        
        switch (reminder.kind) {
          case 'day_report':
            const report = {
              date: new Date().toISOString().split('T')[0],
              totals: userData.totals,
              plan: userData.plan,
              meals: userData.meals,
              advice: generatePersonalAdvice(userData.totals, userData.plan, userData.user.tone),
              user: userData.user
            };
            success = await sendDayReport(reminder.user_id, report, botToken);
            break;
            
          case 'meal':
            success = await sendMealReminder(
              reminder.user_id, 
              botToken, 
              userData.user.tone
            );
            break;
            
          case 'weigh':
            success = await sendWeighReminder(
              reminder.user_id, 
              botToken, 
              userData.user.tone
            );
            break;
        }
        
        if (success) {
          processed++;
        } else {
          errors++;
        }
        
      } catch (error) {
        console.error(`Error processing reminder ${reminder.id}:`, error);
        errors++;
      }
    }
    
  } catch (error) {
    console.error('Error in processReminders:', error);
    errors++;
  }
  
  return { processed, errors };
}

/**
 * Логирование события
 */
async function logEvent(
  event: string,
  userId: number | undefined,
  meta: Record<string, any>,
  supabase: any
): Promise<void> {
  try {
    await supabase
      .from('events_log')
      .insert({
        event,
        user_id: userId,
        meta_json: meta,
        created_at: new Date().toISOString()
      });
    
    console.log(`Event logged: ${event} for user ${userId}`, meta);
  } catch (error) {
    console.error('Error logging event:', error);
  }
}

serve(async (req) => {
  try {
    console.log('Starting reminder processing...')
    
    // Обрабатываем напоминания
    const result = await processReminders(supabase, TELEGRAM_BOT_TOKEN)
    
    console.log(`Processed ${result.processed} reminders, ${result.errors} errors`)
    
    // Логируем статистику
    await logEvent('reminder_cron', undefined, {
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString()
    }, supabase)
    
    return new Response(JSON.stringify({ 
      success: true, 
      processed: result.processed, 
      errors: result.errors 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
    
  } catch (error) {
    console.error('Error in reminder cron:', error)
    
    await logEvent('error', undefined, {
      error_type: 'reminder_cron',
      error_message: error.message,
      context: { stack: error.stack }
    }, supabase)
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
