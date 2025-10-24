/**
 * Модуль для работы с подписками и монетизацией
 * C.I.D. Bot - Subscription System
 */

export interface SubscriptionPlan {
  id: number
  name: string
  duration_days: number
  price_amount: number
  price_currency: string
  features: any
}

export interface UserSubscription {
  id: number
  user_id: number
  plan_id: number | null
  status: 'trial' | 'active' | 'expired' | 'cancelled'
  started_at: string
  expires_at: string
  is_trial: boolean
  days_remaining?: number
}

/**
 * Проверка активной подписки пользователя
 */
export async function checkSubscription(
  supabase: any,
  userId: number
): Promise<{ hasAccess: boolean; subscription: UserSubscription | null; needsPayment: boolean }> {
  const { data, error } = await supabase
    .rpc('check_subscription_status', { p_user_id: userId })
    .single()

  if (error || !data) {
    // Нет подписки - проверяем, был ли триал
    const { data: existingTrial } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_trial', true)
      .single()

    if (!existingTrial) {
      // Триал не использован - создаем
      return {
        hasAccess: false,
        subscription: null,
        needsPayment: false // Нужен триал, а не оплата
      }
    }

    // Триал был - нужна оплата
    return {
      hasAccess: false,
      subscription: null,
      needsPayment: true
    }
  }

  return {
    hasAccess: data.has_active_subscription,
    subscription: data,
    needsPayment: !data.has_active_subscription
  }
}

/**
 * Создание триального периода для нового пользователя
 */
export async function createTrialSubscription(
  supabase: any,
  userId: number
): Promise<UserSubscription> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // 7 дней триала

  const { data, error } = await supabase
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      plan_id: null,
      status: 'trial',
      is_trial: true,
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Получение доступных планов подписки
 */
export async function getSubscriptionPlans(supabase: any): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .neq('name', 'trial')
    .order('duration_days', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Форматирование сообщения о подписке
 */
export function formatSubscriptionMessage(subscription: UserSubscription | null): string {
  if (!subscription) {
    return `🎁 **Пробный период доступен!**

Получи 7 дней бесплатного доступа ко всем функциям бота.

После триала:
• 1 месяц — 299₽
• 3 месяца — 699₽ (скидка 22%)
• 12 месяцев — 1999₽ (скидка 44%)`
  }

  if (subscription.status === 'trial') {
    const daysLeft = subscription.days_remaining || 0
    return `🎁 **Пробный период**

Осталось дней: ${daysLeft}

После окончания триала выбери подписку:
• 1 месяц — 299₽
• 3 месяца — 699₽ (скидка 22%)
• 12 месяцев — 1999₽ (скидка 44%)`
  }

  if (subscription.status === 'active') {
    const daysLeft = subscription.days_remaining || 0
    return `✅ **Подписка активна**

Осталось дней: ${daysLeft}

Спасибо, что с нами! 💚`
  }

  return `⏰ **Подписка истекла**

Продли подписку, чтобы продолжить:
• 1 месяц — 299₽
• 3 месяца — 699₽ (скидка 22%)
• 12 месяцев — 1999₽ (скидка 44%)`
}

/**
 * Создание платежной ссылки (заглушка для будущей интеграции)
 */
export async function createPaymentLink(
  supabase: any,
  userId: number,
  planId: number,
  amount: number
): Promise<string> {
  // TODO: Интеграция с платежной системой (ЮKassa, Stripe, etc.)
  // Пока возвращаем заглушку
  
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      user_id: userId,
      amount: amount,
      currency: 'RUB',
      status: 'pending',
      payment_provider: 'pending_integration'
    })
    .select()
    .single()

  return `https://payment.example.com/${payment.id}` // Заглушка
}

/**
 * Логирование использования (для лимитов на триале)
 */
export async function logUsage(
  supabase: any,
  userId: number,
  actionType: string
): Promise<void> {
  await supabase
    .from('usage_logs')
    .insert({
      user_id: userId,
      action_type: actionType
    })
}

/**
 * Проверка лимитов для триальных пользователей
 */
export async function checkUsageLimits(
  supabase: any,
  userId: number,
  actionType: string
): Promise<{ allowed: boolean; limit: number; used: number }> {
  const { data: subscription } = await supabase
    .from('user_subscriptions')
    .select('*, subscription_plans(*)')
    .eq('user_id', userId)
    .eq('status', 'trial')
    .single()

  if (!subscription || !subscription.subscription_plans?.features?.limits) {
    return { allowed: true, limit: -1, used: 0 }
  }

  const limits = subscription.subscription_plans.features.limits
  const limitKey = `${actionType}_per_day`
  const limit = limits[limitKey]

  if (!limit) {
    return { allowed: true, limit: -1, used: 0 }
  }

  // Подсчет использования за сегодня
  const today = new Date().toISOString().split('T')[0]
  const { data: logs } = await supabase
    .from('usage_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('action_type', actionType)
    .gte('created_at', `${today}T00:00:00`)

  const used = logs?.length || 0

  return {
    allowed: used < limit,
    limit: limit,
    used: used
  }
}


