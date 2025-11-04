# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

C.I.D. is an AI-powered nutrition Telegram bot written in TypeScript for Deno. The bot helps users track calories, get personalized meal plans, and achieve health goals using OpenAI integration. It runs on Supabase Edge Functions with T-Bank payment integration.

**Tech Stack**: TypeScript (Deno runtime), Supabase (Edge Functions + PostgreSQL), OpenAI API (GPT-4o-mini), Telegram Bot API, T-Bank payment gateway

## Development Commands

### Setup
```bash
# Install dependencies
npm install

# Login to Supabase
supabase login

# Link to Supabase project
supabase link --project-ref your-project-ref

# Push database migrations
supabase db push
```

### Local Development
```bash
# Start local Supabase instance
supabase start

# Serve functions locally
supabase functions serve

# Test a function locally
supabase functions invoke telegram-bot --method POST
```

### Deployment
```bash
# Deploy all functions (no JWT verification for webhook endpoints)
supabase functions deploy --no-verify-jwt

# Deploy specific function
supabase functions deploy telegram-bot --no-verify-jwt

# View logs
supabase functions logs telegram-bot
supabase functions logs tbank-webhook

# View real-time logs (streaming)
supabase functions logs telegram-bot --follow
```

### Webhook Setup
```bash
# Set main bot webhook
supabase functions deploy set-webhook --no-verify-jwt
curl -X POST https://your-project.supabase.co/functions/v1/set-webhook

# Set dev bot webhook (for testing)
supabase functions deploy set-dev-webhook --no-verify-jwt
curl -X POST https://your-project.supabase.co/functions/v1/set-dev-webhook
```

## Architecture

### Function Structure

All Supabase Edge Functions are in `supabase/functions/`:

- **telegram-bot/** - Main bot logic (production)
- **dev-bot/** - Development/testing bot (uses `TELEGRAM_BOT_TOKEN_DEV`)
- **tbank-payment/** - Creates T-Bank payment intents
- **tbank-webhook/** - Processes T-Bank payment callbacks
- **notification-scheduler/** - Scheduled reminders (food, water, tips)
- **send-thank-you-messages/** - Post-payment user engagement
- **broadcast-message/** - Admin tool for mass messaging
- **progress-charts/** - Generates user progress visualizations
- **shopping-list/** - Shopping list feature
- **smart-notifications/** - AI-driven personalized notifications
- **weekly-ai-report/** - Weekly summary reports
- **_shared/** - Reusable utilities (see below)

### Shared Utilities (`supabase/functions/_shared/`)

Import these modules in any function:

**openai.ts** - OpenAI API wrappers:
- `generateNutritionPlan()` - Calculate KBJU (calories, protein, fats, carbs) with AI
- `analyzeFood()` - Parse food descriptions and extract nutrition data
- `suggestMeal()` - Recommend meals based on preferences
- `chatWithAI()` - General conversational AI responses
- `transcribeAudio()` - Whisper API for voice messages

**subscription.ts** - Subscription management:
- `checkSubscription()` - Verify user has active subscription
- `createTrialSubscription()` - Initialize 7-day trial
- `getSubscriptionPlans()` - Fetch available plans
- `formatSubscriptionMessage()` - Format subscription status messages
- `logUsage()` - Track usage for limits
- `checkUsageLimits()` - Enforce trial/paid limits

**calculators.ts** - Nutrition calculations:
- `calculateBMRMifflin()` - Mifflin-St Jeor BMR formula
- `calculateBMRHarris()` - Harris-Benedict BMR formula
- `calculateTDEE()` - Total Daily Energy Expenditure
- `calculateTargetCalories()` - Adjust calories for goals (lose/maintain/gain)
- `calculateMacros()` - Protein/fat/carb distribution
- `calculateFullNutritionPlan()` - Complete plan calculation
- `getMethodologyExplanation()` - Human-readable explanation

### Conversation Memory System

Both `telegram-bot` and `dev-bot` use `ConversationManager` class for context-aware conversations:

- `getRecentMessages(userId, limit)` - Fetch last N messages via `get_recent_messages` RPC
- `addMessage(userId, role, content, intent, confidence, metadata)` - Store message via `add_conversation_message` RPC
- `getCurrentTopic(userId)` - Get active conversation topic via `get_conversation_topic` RPC
- `clearContext(userId)` - Soft-delete conversation history via `clear_conversation_history` RPC
- `checkAndClearIfStale(userId)` - Auto-clear after 30min inactivity

**Intent Detection**: Uses OpenAI GPT-4o-mini to classify user messages:
- `food` - User is logging food intake
- `water` - User is logging water consumption
- `question` - User is asking a nutrition question
- `navigation` - User wants to view their data/stats

The system analyzes last 5 messages for context to improve classification accuracy.

### Payment Flow

1. User requests subscription → `tbank-payment` creates payment intent
2. T-Bank processes payment → sends webhook to `tbank-webhook`
3. `tbank-webhook` verifies signature, activates subscription, notifies user
4. `send-thank-you-messages` sends welcome message post-purchase

**Important**: T-Bank webhook signature uses SHA-256 with simple params only (no nested objects). Both `tbank-payment` and `tbank-webhook` have matching `generateToken()` implementations.

### Streak System (Gamification)

The bot includes a Duolingo-style streak system for user engagement:

- `update_user_streak(user_id)` - Automatically called after food logging to update streak
- `get_user_streak_stats(user_id)` - Get user's streak statistics
- **Achievement badges**: Bronze (3 days), Silver (7 days), Gold (14 days), Diamond (30 days), Legend (100 days)
- Users see streak updates immediately after logging food
- Profile displays current streak, longest streak, and total logs

**Important**: Streak logic resets if user misses a day (> 24 hours since last log).

### Database Architecture

Key tables (referenced via RPC functions from bot logic):

- `users` - Telegram user data (includes `current_streak`, `longest_streak`, `last_log_date`, `total_logs_count`)
- `user_profiles` - Height, weight, goals, activity level
- `user_subscriptions` - Subscription status/expiry
- `subscription_plans` - Available plans (trial/monthly/quarterly/yearly/unlimited)
- `payment_intents` - T-Bank payment tracking
- `food_logs` - User food intake records
- `nutrition_plans` - Calculated KBJU targets
- `conversation_history` - Message context for AI
- `user_achievements` - Gamification badges and achievements

**Admin functions** (SQL only, no bot access):
- `admin_subscriptions_view` - View all subscriptions
- `admin_extend_subscription(user_id, days)` - Extend subscription
- `admin_grant_unlimited(telegram_id)` - Grant unlimited access
- `admin_delete_user(user_id)` - Cascade delete user data
- `search_user(username)` - Find user by username
- `get_user_details(telegram_id)` - Full user info

## Environment Variables

Required secrets (set via `supabase secrets set`):

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEGRAM_BOT_TOKEN=your-main-bot-token
TELEGRAM_BOT_TOKEN_DEV=your-dev-bot-token  # For dev-bot only
OPENAI_API_KEY=your-openai-key
TBANK_TERMINAL_KEY=your-terminal-key
TBANK_PASSWORD=your-tbank-password
```

## Bot Configuration Notes

### Main Bot vs Dev Bot

- **telegram-bot** uses `TELEGRAM_BOT_TOKEN` (production)
- **dev-bot** uses `TELEGRAM_BOT_TOKEN_DEV` (testing UI/UX changes)

Both share the same database and logic, but `dev-bot` is for safe experimentation.

### Webhook URLs

Set these in respective bot settings:
- Main: `https://your-project.supabase.co/functions/v1/telegram-bot`
- Dev: `https://your-project.supabase.co/functions/v1/dev-bot`
- T-Bank: `https://your-project.supabase.co/functions/v1/tbank-webhook`

## Development Workflow

### For Code Changes
1. **Make changes** in `supabase/functions/`
2. **Test on dev-bot first** - Deploy to `dev-bot` function to test UI/UX changes safely
3. **Deploy to production** - `supabase functions deploy telegram-bot --no-verify-jwt`
4. **Check logs** - `supabase functions logs telegram-bot --follow`
5. **Test via Telegram** - Send messages to bot and verify behavior

### For Database Changes
1. **Create migration** in `supabase/migration/*.sql`
2. **Test locally** - `supabase db reset` (applies all migrations)
3. **Apply to production** - Copy SQL to Supabase Dashboard SQL Editor and run
4. **Verify** - Check tables/functions exist via SQL queries

**Important**: Always deploy with `--no-verify-jwt` flag for webhook endpoints to work correctly.

## Testing Strategy

### Manual Testing via dev-bot
- Use `dev-bot` for all UI/UX changes before deploying to production
- Test conversation flows, button interactions, and AI responses
- Verify webhook receives updates correctly

### Testing Food Logging
```
# Test simple food log
"Гречка с курицей 200г"

# Test complex food log
"Завтрак: овсянка 50г, банан, чай с медом"

# Test voice message
Send voice message describing food eaten
```

### Testing Subscriptions
```sql
-- Create trial subscription
SELECT * FROM check_subscription_status(user_id);

-- Extend subscription (admin)
SELECT admin_extend_subscription(user_id, 30);

-- Check payment status
SELECT * FROM payment_intents WHERE user_id = X;
```

### Testing Streak System
```sql
-- View user streak stats
SELECT * FROM get_user_streak_stats(user_id);

-- Check achievements
SELECT * FROM user_achievements WHERE user_id = X;

-- View leaderboard
SELECT * FROM streak_leaderboard LIMIT 10;
```

## Common Patterns

### Handling Telegram Updates

```typescript
interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// In serve handler:
const update: TelegramUpdate = await req.json()

if (update.message) {
  // Handle message (text, voice, photo)
}
if (update.callback_query) {
  // Handle inline button clicks
}
```

### Using OpenAI Functions

```typescript
import { analyzeFood, chatWithAI, transcribeAudio } from '../_shared/openai.ts'

// Analyze food description
const nutrition = await analyzeFood("chicken breast 200g, rice 150g")

// Chat with context
const history = await ConversationManager.getRecentMessages(userId, 10)
const response = await chatWithAI(userMessage, history)

// Transcribe voice
const audioBuffer = await getFileBuffer(voice.file_id)
const transcript = await transcribeAudio(audioBuffer)
```

### Checking Subscription

```typescript
import { checkSubscription } from '../_shared/subscription.ts'

const { hasAccess, subscription, needsPayment } = await checkSubscription(supabase, userId)

if (!hasAccess) {
  if (needsPayment) {
    // Show payment options
  } else {
    // Offer trial
  }
}
```

### Database RPC Calls

```typescript
// Get recent messages
const { data: messages } = await supabase.rpc('get_recent_messages', {
  p_user_id: userId,
  p_limit: 10
})

// Add conversation message
await supabase.rpc('add_conversation_message', {
  p_user_id: userId,
  p_role: 'user',
  p_content: text,
  p_intent: 'food',
  p_confidence: 0.95,
  p_metadata: {}
})

// Check subscription status
const { data: status } = await supabase.rpc('check_subscription_status', {
  p_user_id: userId
})
```

## Working with Deno

### Import Patterns
```typescript
// Deno standard library (always use specific version)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// NPM packages via esm.sh (specify version)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Local imports (relative paths)
import { analyzeFood } from '../_shared/openai.ts'
```

### Environment Variables
All functions access env vars via `Deno.env.get()`:
```typescript
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
```

Set via: `supabase secrets set KEY=value`

### HTTP Server Pattern
Every Supabase Edge Function uses this pattern:
```typescript
serve(async (req) => {
  try {
    // Handle request
    const update = await req.json()

    // Process logic

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Error:', error)
    return new Response('Error', { status: 500 })
  }
})
```

## Debugging Tips

- **Logs are your friend**: Use `supabase functions logs <function-name> --follow` extensively
- **Console.log freely**: All console output appears in function logs
- **Test webhooks locally**: Use ngrok or similar for local webhook testing
- **Check T-Bank dashboard**: Verify payment webhooks are being sent
- **Database access**: Use Supabase Dashboard SQL editor for direct queries
- **RPC debugging**: Use `console.log` inside PostgreSQL functions via `RAISE NOTICE`

## Key Design Decisions

1. **No JWT verification** (`--no-verify-jwt`) - Required for webhook endpoints that receive external POST requests
2. **Conversation context** - 30-minute timeout for automatic context clearing
3. **Intent detection** - Uses AI (GPT-4o-mini) instead of regex for better accuracy
4. **Trial-first model** - All new users get 7-day trial before payment
5. **Shared utilities** - Common functions in `_shared/` to reduce duplication
6. **RPC-based data access** - Most database operations use stored procedures for consistency
7. **Deno runtime** - All functions use Deno's stdlib imports (e.g., `https://deno.land/std@0.168.0/...`)
8. **ESM imports** - Use esm.sh for npm packages (e.g., `https://esm.sh/@supabase/supabase-js@2.39.3`)

## Architecture Patterns

### Two-Bot Setup
- **telegram-bot** (production) - Uses `TELEGRAM_BOT_TOKEN`
- **dev-bot** (testing) - Uses `TELEGRAM_BOT_TOKEN_DEV`
- Both share database and codebase, allowing safe UI/UX testing before production deploy

### ConversationManager Pattern
All bot functions use the `ConversationManager` class for stateful conversations:
```typescript
class ConversationManager {
  static async getRecentMessages(userId, limit)
  static async addMessage(userId, role, content, intent, confidence, metadata)
  static async getCurrentTopic(userId)
  static async clearContext(userId)
  static async checkAndClearIfStale(userId) // Auto-clear after 30min
}
```

This class wraps RPC calls to `conversation_history` table and manages message context for AI responses.

### Food Logging Flow
1. User sends text/voice/photo → `telegram-bot`
2. Intent detection classifies message (food/water/question/navigation)
3. If `food`: OpenAI analyzes description → extracts KBJU → stores in `food_logs`
4. Streak system automatically triggered via `update_user_streak(user_id)`
5. Bot responds with nutrition breakdown + streak update + achievements

### Payment Webhook Flow
1. `tbank-payment` creates payment intent with `NotificationURL` pointing to `tbank-webhook`
2. T-Bank processes payment → POST to `tbank-webhook` with signature
3. `tbank-webhook` verifies SHA-256 signature using `generateToken()`
4. Updates `user_subscriptions` and `payment_intents` tables
5. Sends Telegram notification to user
6. `send-thank-you-messages` function sends follow-up message

## Common Gotchas

### 1. Webhook Not Working
**Problem**: Bot doesn't respond to messages
**Solution**:
```bash
# Check webhook status
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Delete and reset webhook
supabase functions deploy set-webhook --no-verify-jwt
curl -X POST https://your-project.supabase.co/functions/v1/set-webhook
```

### 2. Intent Detection Failures
**Problem**: Bot misclassifies user intent (e.g., food as question)
**Solution**: Check conversation history - intent detection uses last 5 messages for context. Clear stale context if > 30 minutes old.

### 3. Streak Not Updating
**Problem**: User logs food but streak doesn't increment
**Solution**: Verify `update_user_streak` RPC exists and is called after `food_logs` insert. Check function logs for RPC errors.

### 4. Duplicate Payment Notifications
**Problem**: User receives multiple payment success messages
**Solution**: Check `tbank-webhook` deduplication logic - should check `payment_intents` status before processing.

### 5. OpenAI Rate Limits
**Problem**: Bot stops responding due to OpenAI API limits
**Solution**:
- Check OpenAI dashboard for rate limit status
- Consider implementing request queuing
- Use GPT-4o-mini (cheaper/faster) for intent detection, GPT-4 for complex tasks

## Quick Reference

### Most Common Commands
```bash
# Deploy and view logs
supabase functions deploy telegram-bot --no-verify-jwt && supabase functions logs telegram-bot --follow

# Check subscription status
SELECT * FROM check_subscription_status(user_id);

# Get user by telegram username
SELECT * FROM search_user('username');

# View recent food logs
SELECT * FROM food_logs WHERE user_id = X ORDER BY created_at DESC LIMIT 10;
```

### Key File Locations
- Bot logic: `supabase/functions/telegram-bot/index.ts`
- Dev bot: `supabase/functions/dev-bot/index.ts`
- OpenAI utils: `supabase/functions/_shared/openai.ts`
- Subscription logic: `supabase/functions/_shared/subscription.ts`
- Calculators: `supabase/functions/_shared/calculators.ts`
- Migrations: `supabase/migration/*.sql`
- Documentation: Root `.md` files (STREAK_SYSTEM.md, TEST_SCENARIOS.md, etc.)
