// Система аналитики и логирования событий
// Отслеживание событий, метрики и дашборд

// Типы для типизации
type EventType = 'onboarding' | 'meal_add' | 'plan_update' | 'reminder_fire' | 'voice_intent' | 'error';

interface EventData {
  event: EventType;
  user_id?: number;
  meta_json: Record<string, any>;
  created_at: string;
}

interface AnalyticsMetrics {
  active_users: number;
  daily_events: number;
  avg_deficit: number;
  frequent_adjustments: number;
  voice_usage: number;
  reminder_success_rate: number;
}

interface DashboardData {
  metrics: AnalyticsMetrics;
  charts: {
    daily_active_users: Array<{ date: string; count: number }>;
    event_types: Array<{ type: string; count: number }>;
    user_retention: Array<{ day: number; percentage: number }>;
  };
}

// Основные функции

/**
 * Логирование события
 */
export async function logEvent(
  event: EventType,
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

/**
 * Логирование онбординга
 */
export async function logOnboarding(
  userId: number,
  step: string,
  data: any,
  supabase: any
): Promise<void> {
  await logEvent('onboarding', userId, {
    step,
    data: {
      age: data.age,
      sex: data.sex,
      height: data.height_cm,
      weight: data.weight_kg,
      activity: data.activity,
      goal: data.goal
    }
  }, supabase);
}

/**
 * Логирование добавления приёма пищи
 */
export async function logMealAdd(
  userId: number,
  mealData: any,
  source: 'text' | 'photo' | 'voice',
  supabase: any
): Promise<void> {
  await logEvent('meal_add', userId, {
    source,
    meal: {
      name: mealData.name,
      calories: mealData.calories,
      protein: mealData.protein,
      fat: mealData.fat,
      carbs: mealData.carbs
    }
  }, supabase);
}

/**
 * Логирование обновления плана
 */
export async function logPlanUpdate(
  userId: number,
  oldPlan: any,
  newPlan: any,
  adjustmentType: 'auto' | 'manual',
  supabase: any
): Promise<void> {
  await logEvent('plan_update', userId, {
    adjustment_type: adjustmentType,
    old_plan: oldPlan,
    new_plan: newPlan,
    changes: {
      calories_diff: newPlan.kcal - oldPlan.kcal,
      protein_diff: newPlan.protein - oldPlan.protein,
      fat_diff: newPlan.fat - oldPlan.fat,
      carbs_diff: newPlan.carbs - oldPlan.carbs
    }
  }, supabase);
}

/**
 * Логирование срабатывания напоминания
 */
export async function logReminderFire(
  userId: number,
  reminderType: string,
  success: boolean,
  supabase: any
): Promise<void> {
  await logEvent('reminder_fire', userId, {
    reminder_type: reminderType,
    success,
    timestamp: new Date().toISOString()
  }, supabase);
}

/**
 * Логирование голосового намерения
 */
export async function logVoiceIntent(
  userId: number,
  intent: string,
  confidence: number,
  transcribedText: string,
  supabase: any
): Promise<void> {
  await logEvent('voice_intent', userId, {
    intent,
    confidence,
    transcribed_text: transcribedText.slice(0, 100), // ограничиваем длину
    text_length: transcribedText.length
  }, supabase);
}

/**
 * Логирование ошибки
 */
export async function logError(
  userId: number | undefined,
  errorType: string,
  errorMessage: string,
  context: any,
  supabase: any
): Promise<void> {
  await logEvent('error', userId, {
    error_type: errorType,
    error_message: errorMessage.slice(0, 200), // ограничиваем длину
    context: JSON.stringify(context).slice(0, 500)
  }, supabase);
}

/**
 * Получение метрик аналитики
 */
export async function getAnalyticsMetrics(supabase: any): Promise<AnalyticsMetrics> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    // Активные пользователи за последние 7 дней
    const { data: activeUsers } = await supabase
      .from('events_log')
      .select('user_id')
      .gte('created_at', weekAgoStr)
      .not('user_id', 'is', null);
    
    const uniqueUsers = new Set(activeUsers?.map(e => e.user_id) || []);
    
    // События за сегодня
    const { data: todayEvents } = await supabase
      .from('events_log')
      .select('id')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);
    
    // Средний дефицит калорий
    const { data: dailyTotals } = await supabase
      .from('daily_totals')
      .select('kcal')
      .gte('date', weekAgoStr);
    
    const { data: plans } = await supabase
      .from('plans')
      .select('kcal')
      .eq('is_active', true);
    
    let avgDeficit = 0;
    if (dailyTotals && plans) {
      const deficits = dailyTotals.map(total => {
        const plan = plans.find(p => true); // упрощённо
        return plan ? plan.kcal - total.kcal : 0;
      }).filter(d => d > 0);
      
      avgDeficit = deficits.length > 0 ? 
        deficits.reduce((sum, d) => sum + d, 0) / deficits.length : 0;
    }
    
    // Частые корректировки планов
    const { data: planUpdates } = await supabase
      .from('events_log')
      .select('user_id')
      .eq('event', 'plan_update')
      .gte('created_at', weekAgoStr);
    
    const userPlanUpdates = planUpdates?.reduce((acc, event) => {
      acc[event.user_id] = (acc[event.user_id] || 0) + 1;
      return acc;
    }, {} as Record<number, number>) || {};
    
    const frequentAdjustments = Object.values(userPlanUpdates)
      .filter(count => count >= 3).length;
    
    // Использование голоса
    const { data: voiceEvents } = await supabase
      .from('events_log')
      .select('id')
      .eq('event', 'voice_intent')
      .gte('created_at', weekAgoStr);
    
    // Успешность напоминаний
    const { data: reminderEvents } = await supabase
      .from('events_log')
      .select('meta_json')
      .eq('event', 'reminder_fire')
      .gte('created_at', weekAgoStr);
    
    const successfulReminders = reminderEvents?.filter(e => 
      e.meta_json?.success === true
    ).length || 0;
    
    const reminderSuccessRate = reminderEvents?.length > 0 ? 
      (successfulReminders / reminderEvents.length) * 100 : 0;
    
    return {
      active_users: uniqueUsers.size,
      daily_events: todayEvents?.length || 0,
      avg_deficit: Math.round(avgDeficit),
      frequent_adjustments: frequentAdjustments,
      voice_usage: voiceEvents?.length || 0,
      reminder_success_rate: Math.round(reminderSuccessRate)
    };
  } catch (error) {
    console.error('Error getting analytics metrics:', error);
    return {
      active_users: 0,
      daily_events: 0,
      avg_deficit: 0,
      frequent_adjustments: 0,
      voice_usage: 0,
      reminder_success_rate: 0
    };
  }
}

/**
 * Получение данных для дашборда
 */
export async function getDashboardData(supabase: any): Promise<DashboardData> {
  try {
    const metrics = await getAnalyticsMetrics(supabase);
    
    // График активных пользователей по дням
    const dailyActiveUsers = await getDailyActiveUsers(supabase);
    
    // График типов событий
    const eventTypes = await getEventTypesDistribution(supabase);
    
    // График удержания пользователей
    const userRetention = await getUserRetention(supabase);
    
    return {
      metrics,
      charts: {
        daily_active_users: dailyActiveUsers,
        event_types: eventTypes,
        user_retention: userRetention
      }
    };
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    return {
      metrics: {
        active_users: 0,
        daily_events: 0,
        avg_deficit: 0,
        frequent_adjustments: 0,
        voice_usage: 0,
        reminder_success_rate: 0
      },
      charts: {
        daily_active_users: [],
        event_types: [],
        user_retention: []
      }
    };
  }
}

/**
 * Получение активных пользователей по дням
 */
async function getDailyActiveUsers(supabase: any): Promise<Array<{ date: string; count: number }>> {
  try {
    const { data } = await supabase
      .from('events_log')
      .select('created_at, user_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not('user_id', 'is', null);
    
    if (!data) return [];
    
    // Группируем по дням
    const dailyUsers: Record<string, Set<number>> = {};
    
    data.forEach(event => {
      const date = event.created_at.split('T')[0];
      if (!dailyUsers[date]) {
        dailyUsers[date] = new Set();
      }
      dailyUsers[date].add(event.user_id);
    });
    
    return Object.entries(dailyUsers).map(([date, users]) => ({
      date,
      count: users.size
    })).sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error('Error getting daily active users:', error);
    return [];
  }
}

/**
 * Получение распределения типов событий
 */
async function getEventTypesDistribution(supabase: any): Promise<Array<{ type: string; count: number }>> {
  try {
    const { data } = await supabase
      .from('events_log')
      .select('event')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!data) return [];
    
    const eventCounts: Record<string, number> = {};
    data.forEach(event => {
      eventCounts[event.event] = (eventCounts[event.event] || 0) + 1;
    });
    
    return Object.entries(eventCounts).map(([type, count]) => ({
      type,
      count
    }));
  } catch (error) {
    console.error('Error getting event types distribution:', error);
    return [];
  }
}

/**
 * Получение удержания пользователей
 */
async function getUserRetention(supabase: any): Promise<Array<{ day: number; percentage: number }>> {
  try {
    // Упрощённый расчёт удержания
    const { data: users } = await supabase
      .from('users')
      .select('created_at');
    
    if (!users) return [];
    
    const retention: Array<{ day: number; percentage: number }> = [];
    
    for (let day = 1; day <= 7; day++) {
      const dayAgo = new Date(Date.now() - day * 24 * 60 * 60 * 1000);
      
      const { data: activeUsers } = await supabase
        .from('events_log')
        .select('user_id')
        .gte('created_at', dayAgo.toISOString())
        .not('user_id', 'is', null);
      
      const uniqueUsers = new Set(activeUsers?.map(e => e.user_id) || []);
      const percentage = users.length > 0 ? (uniqueUsers.size / users.length) * 100 : 0;
      
      retention.push({ day, percentage: Math.round(percentage) });
    }
    
    return retention;
  } catch (error) {
    console.error('Error getting user retention:', error);
    return [];
  }
}

/**
 * Форматирование данных дашборда для отображения
 */
export function formatDashboardData(data: DashboardData): string {
  const { metrics, charts } = data;
  
  return `📊 АНАЛИТИКА БОТА

👥 ПОЛЬЗОВАТЕЛИ:
• Активных за неделю: ${metrics.active_users}
• Событий сегодня: ${metrics.daily_events}
• Удержание (7 дней): ${charts.user_retention[6]?.percentage || 0}%

📈 МЕТРИКИ:
• Средний дефицит: ${metrics.avg_deficit} ккал
• Частые корректировки: ${metrics.frequent_adjustments} пользователей
• Использование голоса: ${metrics.voice_usage} раз
• Успешность напоминаний: ${metrics.reminder_success_rate}%

📊 СОБЫТИЯ ЗА НЕДЕЛЮ:
${charts.event_types.map(e => `• ${e.type}: ${e.count}`).join('\n')}

📅 АКТИВНОСТЬ ПО ДНЯМ:
${charts.daily_active_users.slice(-7).map(d => `• ${d.date}: ${d.count} пользователей`).join('\n')}`;
}

/**
 * Получение топ событий за период
 */
export async function getTopEvents(
  days: number = 7,
  limit: number = 10,
  supabase: any
): Promise<Array<{ event: string; count: number; last_seen: string }>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const { data } = await supabase
      .from('events_log')
      .select('event, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    
    if (!data) return [];
    
    const eventCounts: Record<string, { count: number; last_seen: string }> = {};
    
    data.forEach(event => {
      if (!eventCounts[event.event]) {
        eventCounts[event.event] = { count: 0, last_seen: event.created_at };
      }
      eventCounts[event.event].count++;
    });
    
    return Object.entries(eventCounts)
      .map(([event, data]) => ({ event, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (error) {
    console.error('Error getting top events:', error);
    return [];
  }
}

export default {
  logEvent,
  logOnboarding,
  logMealAdd,
  logPlanUpdate,
  logReminderFire,
  logVoiceIntent,
  logError,
  getAnalyticsMetrics,
  getDashboardData,
  formatDashboardData,
  getTopEvents
};
