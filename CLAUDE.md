# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

C.I.D. is an AI-powered nutrition Telegram bot written in TypeScript for Deno. The bot helps users track calories, get personalized meal plans, and achieve health goals using OpenAI integration. It runs on Supabase Edge Functions with T-Bank payment integration.

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

### Database Architecture

Key tables (referenced via RPC functions from bot logic):

- `users` - Telegram user data
- `user_profiles` - Height, weight, goals, activity level
- `user_subscriptions` - Subscription status/expiry
- `subscription_plans` - Available plans (trial/monthly/quarterly/yearly/unlimited)
- `payment_intents` - T-Bank payment tracking
- `food_logs` - User food intake records
- `nutrition_plans` - Calculated KBJU targets
- `conversation_history` - Message context for AI

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

1. **Make changes** in `supabase/functions/`
2. **Test locally** with `supabase functions serve` (optional)
3. **Deploy function** with `supabase functions deploy <function-name> --no-verify-jwt`
4. **Check logs** with `supabase functions logs <function-name>`
5. **Test via Telegram** - send messages to bot

**Important**: Always deploy with `--no-verify-jwt` flag for webhook endpoints to work correctly.

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

## Debugging Tips

- **Logs are your friend**: Use `supabase functions logs <function-name>` extensively
- **Console.log freely**: All console output appears in function logs
- **Test webhooks locally**: Use ngrok or similar for local webhook testing
- **Check T-Bank dashboard**: Verify payment webhooks are being sent
- **Database access**: Use Supabase Dashboard SQL editor for direct queries

## Key Design Decisions

1. **No JWT verification** (`--no-verify-jwt`) - Required for webhook endpoints that receive external POST requests
2. **Conversation context** - 30-minute timeout for automatic context clearing
3. **Intent detection** - Uses AI (GPT-4o-mini) instead of regex for better accuracy
4. **Trial-first model** - All new users get 7-day trial before payment
5. **Shared utilities** - Common functions in `_shared/` to reduce duplication
6. **RPC-based data access** - Most database operations use stored procedures for consistency
