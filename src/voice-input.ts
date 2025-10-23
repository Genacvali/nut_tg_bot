// Система голосового ввода (STT) для Telegram бота
// Поддержка voice/video note, транскрипция и обработка намерений

// Типы для типизации
interface VoiceIntent {
  type: 'meal_add' | 'weight_update' | 'macro_adjust' | 'reminder_set' | 'help' | 'unknown';
  confidence: number;
  data?: any;
  originalText: string;
}

interface MealData {
  name: string;
  calories?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  weight?: number;
}

interface MacroAdjustment {
  protein?: { value: number; type: 'grams' | 'percent' };
  fat?: { value: number; type: 'grams' | 'percent' };
  carbs?: { value: number; type: 'grams' | 'percent' };
}

// Константы
const MAX_VOICE_DURATION = 120; // секунд
const MIN_VOICE_DURATION = 1;   // секунд
const SUPPORTED_FORMATS = ['ogg', 'opus', 'mp3', 'wav'];

// Основные функции

/**
 * Проверка валидности голосового сообщения
 */
export function validateVoiceMessage(voice: any): { valid: boolean; error?: string } {
  if (!voice) {
    return { valid: false, error: 'Голосовое сообщение не найдено' };
  }
  
  if (voice.duration > MAX_VOICE_DURATION) {
    return { valid: false, error: `Сообщение слишком длинное (максимум ${MAX_VOICE_DURATION} сек)` };
  }
  
  if (voice.duration < MIN_VOICE_DURATION) {
    return { valid: false, error: 'Сообщение слишком короткое' };
  }
  
  return { valid: true };
}

/**
 * Получение URL файла голосового сообщения
 */
export async function getVoiceFileUrl(fileId: string, botToken: string): Promise<string> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error('Не удалось получить файл');
    }
    
    return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
  } catch (error) {
    console.error('Error getting voice file URL:', error);
    throw error;
  }
}

/**
 * Транскрипция голосового сообщения с помощью OpenAI Whisper
 */
export async function transcribeVoice(
  fileUrl: string, 
  openaiApiKey: string, 
  language: string = 'ru'
): Promise<string> {
  try {
    // Скачиваем аудио файл
    const audioResponse = await fetch(fileUrl);
    const audioBlob = await audioResponse.blob();
    
    // Создаем FormData для Whisper API
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'text');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`);
    }
    
    const text = await response.text();
    return text.trim();
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Не удалось распознать голосовое сообщение');
  }
}

/**
 * Анализ намерения из транскрибированного текста
 */
export function analyzeVoiceIntent(text: string): VoiceIntent {
  const lowerText = text.toLowerCase();
  
  // Паттерны для разных намерений
  const patterns = {
    meal_add: [
      /(ел|съел|поел|завтракал|обедал|ужинал|перекусил|съела|поела)/i,
      /(добавь|добавить|запиши|записать).*(еду|еда|блюдо|приём)/i,
      /(курица|мясо|рыба|овощи|фрукты|каша|суп|салат)/i
    ],
    weight_update: [
      /(вес|вешу|взвесился|взвесилась)/i,
      /(обнови|обновить|измени|изменить).*вес/i,
      /\d+\.?\d*\s*(кг|килограмм)/i
    ],
    macro_adjust: [
      /(белок|белки|протеин)/i,
      /(жир|жиры|углевод|углеводы)/i,
      /(пересчитай|пересчитать|настрой|настроить).*(макрос|кбжу)/i,
      /(\+|\-)\d+.*(г|%|грамм|процент)/i
    ],
    reminder_set: [
      /(напомни|напоминание|отчёт|отчет)/i,
      /(поставь|поставить|установи|установить).*(напоминание|отчёт)/i,
      /\d{1,2}:\d{2}/i
    ],
    help: [
      /(помоги|помощь|что|как|не знаю)/i,
      /(что делать|что поесть|что съесть)/i
    ]
  };
  
  // Подсчитываем совпадения для каждого типа
  const scores: Record<string, number> = {};
  
  for (const [intent, intentPatterns] of Object.entries(patterns)) {
    scores[intent] = intentPatterns.reduce((score, pattern) => {
      return score + (pattern.test(text) ? 1 : 0);
    }, 0);
  }
  
  // Находим намерение с наибольшим количеством совпадений
  const bestIntent = Object.entries(scores).reduce((best, [intent, score]) => {
    return score > best.score ? { intent, score } : best;
  }, { intent: 'unknown', score: 0 });
  
  // Извлекаем данные в зависимости от типа намерения
  let data: any = {};
  
  switch (bestIntent.intent) {
    case 'meal_add':
      data = extractMealData(text);
      break;
    case 'weight_update':
      data = extractWeightData(text);
      break;
    case 'macro_adjust':
      data = extractMacroAdjustment(text);
      break;
    case 'reminder_set':
      data = extractReminderData(text);
      break;
  }
  
  return {
    type: bestIntent.intent as VoiceIntent['type'],
    confidence: Math.min(bestIntent.score / 3, 1), // нормализуем до 0-1
    data,
    originalText: text
  };
}

/**
 * Извлечение данных о еде из текста
 */
function extractMealData(text: string): MealData {
  const data: MealData = { name: text };
  
  // Извлекаем числа (калории, граммы)
  const numbers = text.match(/\d+/g) || [];
  
  // Паттерны для макросов
  const calorieMatch = text.match(/(\d+)\s*(ккал|калори)/i);
  const proteinMatch = text.match(/(\d+)\s*(г\s*)?(белк|протеин)/i);
  const fatMatch = text.match(/(\d+)\s*(г\s*)?(жир)/i);
  const carbsMatch = text.match(/(\d+)\s*(г\s*)?(углевод)/i);
  const weightMatch = text.match(/(\d+)\s*(г|грамм)/i);
  
  if (calorieMatch) data.calories = parseInt(calorieMatch[1]);
  if (proteinMatch) data.protein = parseInt(proteinMatch[1]);
  if (fatMatch) data.fat = parseInt(fatMatch[1]);
  if (carbsMatch) data.carbs = parseInt(carbsMatch[1]);
  if (weightMatch) data.weight = parseInt(weightMatch[1]);
  
  return data;
}

/**
 * Извлечение данных о весе
 */
function extractWeightData(text: string): { weight: number } {
  const weightMatch = text.match(/(\d+\.?\d*)\s*(кг|килограмм)/i);
  return {
    weight: weightMatch ? parseFloat(weightMatch[1]) : 0
  };
}

/**
 * Извлечение корректировок макросов
 */
function extractMacroAdjustment(text: string): MacroAdjustment {
  const adjustment: MacroAdjustment = {};
  
  // Паттерны для граммов
  const proteinGramsMatch = text.match(/белк[а-я]*\s*(\d+)\s*г/i);
  const fatGramsMatch = text.match(/жир[а-я]*\s*(\d+)\s*г/i);
  const carbsGramsMatch = text.match(/углевод[а-я]*\s*(\d+)\s*г/i);
  
  // Паттерны для процентов
  const proteinPercentMatch = text.match(/белк[а-я]*\s*([+-]?\d+)\s*%/i);
  const fatPercentMatch = text.match(/жир[а-я]*\s*([+-]?\d+)\s*%/i);
  const carbsPercentMatch = text.match(/углевод[а-я]*\s*([+-]?\d+)\s*%/i);
  
  if (proteinGramsMatch) {
    adjustment.protein = { value: parseInt(proteinGramsMatch[1]), type: 'grams' };
  } else if (proteinPercentMatch) {
    adjustment.protein = { value: parseInt(proteinPercentMatch[1]), type: 'percent' };
  }
  
  if (fatGramsMatch) {
    adjustment.fat = { value: parseInt(fatGramsMatch[1]), type: 'grams' };
  } else if (fatPercentMatch) {
    adjustment.fat = { value: parseInt(fatPercentMatch[1]), type: 'percent' };
  }
  
  if (carbsGramsMatch) {
    adjustment.carbs = { value: parseInt(carbsGramsMatch[1]), type: 'grams' };
  } else if (carbsPercentMatch) {
    adjustment.carbs = { value: parseInt(carbsPercentMatch[1]), type: 'percent' };
  }
  
  return adjustment;
}

/**
 * Извлечение данных о напоминаниях
 */
function extractReminderData(text: string): { time?: string; type?: string } {
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  const typeMatch = text.match(/(отчёт|отчет|еда|приём|взвешивание)/i);
  
  return {
    time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : undefined,
    type: typeMatch ? typeMatch[1].toLowerCase() : undefined
  };
}

/**
 * Обработка голосового сообщения - главная функция
 */
export async function processVoiceMessage(
  voice: any,
  fileId: string,
  userId: number,
  botToken: string,
  openaiApiKey: string,
  language: string = 'ru'
): Promise<{
  success: boolean;
  intent?: VoiceIntent;
  error?: string;
  echoText?: string;
}> {
  try {
    // Валидация
    const validation = validateVoiceMessage(voice);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    // Получение URL файла
    const fileUrl = await getVoiceFileUrl(fileId, botToken);
    
    // Транскрипция
    const transcribedText = await transcribeVoice(fileUrl, openaiApiKey, language);
    
    if (!transcribedText || transcribedText.length < 3) {
      return { 
        success: false, 
        error: 'Не удалось распознать речь. Попробуйте говорить четче.' 
      };
    }
    
    // Анализ намерения
    const intent = analyzeVoiceIntent(transcribedText);
    
    return {
      success: true,
      intent,
      echoText: `📝 Распознано: "${transcribedText}"`
    };
    
  } catch (error) {
    console.error('Voice processing error:', error);
    return {
      success: false,
      error: 'Ошибка при обработке голосового сообщения'
    };
  }
}

/**
 * Форматирование ответа на голосовое сообщение
 */
export function formatVoiceResponse(intent: VoiceIntent): string {
  switch (intent.type) {
    case 'meal_add':
      return `🍽️ Добавляю приём пищи: "${intent.originalText}"`;
      
    case 'weight_update':
      const weight = intent.data?.weight;
      return `⚖️ Обновляю вес: ${weight} кг`;
      
    case 'macro_adjust':
      return `⚙️ Корректирую макросы согласно вашему запросу`;
      
    case 'reminder_set':
      const time = intent.data?.time;
      return `⏰ Устанавливаю напоминание на ${time}`;
      
    case 'help':
      return `❓ Помогаю с вашим вопросом`;
      
    case 'unknown':
      return `🤔 Не совсем понял. Попробуйте сказать:
• "Добавь курицу 200 ккал"
• "Обнови вес 75 кг"
• "Пересчитай макросы: белок +20г"
• "Поставь отчёт на 21:00"`;
      
    default:
      return 'Обрабатываю ваш запрос...';
  }
}

/**
 * Получение вариантов действий при неясном намерении
 */
export function getUnclearIntentOptions(): string[] {
  return [
    'Добавить приём пищи',
    'Изменить вес',
    'Пересчитать макросы',
    'Напоминание',
    'Помощь'
  ];
}

export default {
  validateVoiceMessage,
  getVoiceFileUrl,
  transcribeVoice,
  analyzeVoiceIntent,
  processVoiceMessage,
  formatVoiceResponse,
  getUnclearIntentOptions
};
