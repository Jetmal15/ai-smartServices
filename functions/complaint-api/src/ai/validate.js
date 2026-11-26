/**
 * Everything the AI returns is untrusted. This turns the provider's text into a clean analysis or throws AnalysisError.
 * Only whitelisted fields are read; enumerations must match exactly; category keys must be ones we offered.
 */
export const RULES = {
  summaryMax: 400,
  reasonMax: 500,
  keywords: { max: 8, length: 30 },
  maxAttempts: 10,
  input: { titleMax: 150, descriptionMax: 2000 },
}
export const PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const SENTIMENTS = ['positive', 'neutral', 'negative']

export class AnalysisError extends Error {}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
/** Plain text: no control characters, no HTML tags, collapsed whitespace. */
export const cleanText = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()

function truncate(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Finds the JSON object in the answer (the model may wrap it in a code fence or add a sentence). */
export function parseAiJson(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start === -1 || end <= start) throw new AnalysisError('The AI answer contained no JSON object.')
  let value
  try {
    value = JSON.parse(source.slice(start, end + 1))
  } catch {
    throw new AnalysisError('The AI answer was not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AnalysisError('The AI answer was not a JSON object.')
  return value
}

/**
 * @param raw        parsed AI JSON
 * @param categories Map of the keys we offered ("C1"…) to category objects
 * @returns { summary, category (object|null), priority, sentiment, keywords, confidence, reason }
 */
export function validateAnalysis(raw, categories) {
  const fail = (why) => {
    throw new AnalysisError(`Invalid AI answer: ${why}.`)
  }

  if (typeof raw.summary !== 'string') fail('summary missing')
  const summaryFull = cleanText(raw.summary)
  if (!summaryFull) fail('summary empty')
  if (summaryFull.length > RULES.summaryMax * 2.5) fail('summary far too long')
  const summary = truncate(summaryFull, RULES.summaryMax)

  let category = null
  if (raw.categoryKey !== null && raw.categoryKey !== undefined && String(raw.categoryKey).toLowerCase() !== 'none') {
    if (typeof raw.categoryKey !== 'string') fail('category key is not text')
    category = categories.get(raw.categoryKey.trim().toUpperCase()) ?? null
    if (!category) fail('category key was not one of the offered categories')
  }

  const priority = typeof raw.priority === 'string' ? raw.priority.trim().toLowerCase() : ''
  if (!PRIORITIES.includes(priority)) fail('priority is not low, medium, high or urgent')

  let sentiment = 'neutral'
  if (raw.sentiment !== undefined && raw.sentiment !== null) {
    sentiment = typeof raw.sentiment === 'string' ? raw.sentiment.trim().toLowerCase() : ''
    if (!SENTIMENTS.includes(sentiment)) fail('sentiment is not positive, neutral or negative')
  }

  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) fail('confidence is not a number between 0 and 1')

  const keywords = []
  if (Array.isArray(raw.keywords)) {
    for (const item of raw.keywords) {
      if (typeof item !== 'string') continue
      const word = truncate(cleanText(item), RULES.keywords.length)
      if (word && !keywords.some((k) => k.toLowerCase() === word.toLowerCase())) keywords.push(word)
      if (keywords.length >= RULES.keywords.max) break
    }
  }

  const reason = typeof raw.reason === 'string' ? truncate(cleanText(raw.reason), RULES.reasonMax) : ''
  return { summary, category, priority, sentiment, keywords, confidence: raw.confidence, reason }
}
