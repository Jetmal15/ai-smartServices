/**
 * Rule-based analysis used when the AI provider is unavailable, rate limited, not configured or returned something invalid.
 * Deterministic keyword rules: useful, but plainly labelled `fallback` and given low confidence. Never fails.
 */
import { cleanText, RULES } from './validate.js'

/** Keywords per seeded category ID (other categories fall back to words from their own name/description). */
const CATEGORY_KEYWORDS = {
  'lms-issues': ['lms', 'moodle', 'portal', 'quiz', 'assignment upload', 'course page', 'grades', 'login', 'password', 'online class', 'wifi', 'wi-fi', 'internet', 'website'],
  'computer-problems': ['computer', 'pc', 'laptop', 'projector', 'keyboard', 'mouse', 'monitor', 'printer', 'freez', 'crash', 'lab machine', 'software', 'install', 'virus'],
  'water-cooler-issues': ['water', 'cooler', 'dispenser', 'drinking', 'thirst', 'filter', 'tap'],
  'clerk-related-issues': ['clerk', 'office', 'form', 'fee', 'challan', 'certificate', 'transcript', 'document', 'stamp', 'counter', 'admission office', 'record'],
  'cleaning-issues': ['clean', 'dirty', 'dust', 'garbage', 'trash', 'bin', 'washroom', 'toilet', 'smell', 'sweep', 'mop', 'hygiene', 'litter', 'chair', 'broken', 'light', 'fan'],
  'teacher-related-complaints': ['teacher', 'lecturer', 'professor', 'instructor', 'faculty', 'class late', 'marks', 'rude', 'behaviour', 'behavior', 'attendance', 'biased', 'unfair'],
  'student-affairs': ['hostel', 'scholarship', 'society', 'noc', 'transport', 'bus', 'harass', 'bully', 'discipline', 'event', 'id card', 'student card', 'welfare'],
}

const URGENT = ['fire', 'smoke', 'electric shock', 'electrocut', 'short circuit', 'sparks', 'gas leak', 'flood', 'collapse', 'injur', 'bleeding', 'unconscious', 'emergency', 'danger', 'threat', 'harass', 'assault', 'violence', 'weapon', 'suicide', 'self-harm']
const HIGH = ['urgent', 'asap', 'immediately', 'exam', 'deadline', 'no water', 'not working for', 'since monday', 'for days', 'for a week', 'for weeks', 'for a month', 'everyone', 'all students', 'whole', 'unsafe', 'health', 'sick', 'broken', 'blocked', 'cannot access', "can't access", 'unable to']
const LOW = ['suggestion', 'suggest', 'minor', 'small issue', 'slightly', 'when possible', 'whenever', 'cosmetic', 'would be nice', 'request']
const NEGATIVE = ['angry', 'terrible', 'worst', 'unacceptable', 'disgusting', 'fed up', 'frustrated', 'rude', 'useless', 'horrible', 'harass', 'ignored']
const POSITIVE = ['thank', 'appreciate', 'grateful', 'great job', 'helpful']

const count = (text, words) => words.reduce((n, word) => (text.includes(word) ? n + 1 : n), 0)

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'has', 'have', 'not', 'from', 'issues', 'problems', 'related', 'complaints', 'about', 'department'])
const tokens = (text) => cleanText(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3 && !STOP.has(word))

/** First sentence(s) of the description, up to the summary limit. */
function extractiveSummary(title, description) {
  const body = cleanText(description)
  const sentences = body.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  let summary = cleanText(title)
  if (summary && !/[.!?]$/.test(summary)) summary += '.'
  for (const sentence of sentences) {
    if ((summary + ' ' + sentence).length > RULES.summaryMax - 1) break
    summary = summary ? `${summary} ${sentence}` : sentence
    if (summary.length > 200) break
  }
  if (!summary) summary = body.slice(0, RULES.summaryMax - 1)
  return summary.length > RULES.summaryMax ? `${summary.slice(0, RULES.summaryMax - 1).trimEnd()}…` : summary
}

/**
 * @param {{ title: string, description: string }} text  (already redacted)
 * @param {Array<{ id: string, name: string, description?: string }>} categories  the active categories on offer
 */
export function analyzeWithRules({ title, description }, categories) {
  const text = `${title}\n${description}`.toLowerCase()

  let best = null
  let bestScore = 0
  for (const category of categories) {
    const keywords = CATEGORY_KEYWORDS[category.id] ?? tokens(`${category.name} ${category.description ?? ''}`)
    const score = count(text, keywords)
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }

  let priority = 'medium'
  const urgent = count(text, URGENT)
  if (urgent > 0) priority = 'urgent'
  else if (count(text, HIGH) >= 2) priority = 'high'
  else if (count(text, LOW) > 0 && count(text, HIGH) === 0) priority = 'low'
  else if (count(text, HIGH) === 1 && /urgent|asap|immediately|exam|deadline|unsafe/.test(text)) priority = 'high'

  const negative = count(text, NEGATIVE)
  const positive = count(text, POSITIVE)
  const sentiment = negative > positive ? 'negative' : positive > negative ? 'positive' : 'neutral'

  const keywords = [...new Set(tokens(title).concat(tokens(description)))].slice(0, 6).map((word) => word.slice(0, RULES.keywords.length))

  return {
    summary: extractiveSummary(title, description),
    category: best,
    priority,
    sentiment,
    keywords,
    // Deliberately modest: keyword matching is a hint, not an understanding of the complaint.
    confidence: best ? Math.min(0.2 + bestScore * 0.1, 0.5) : 0.1,
    reason: best ? `Matched ${bestScore} keyword${bestScore === 1 ? '' : 's'} for “${best.name}”. Rule-based suggestion.` : 'No category keywords matched. Rule-based suggestion.',
  }
}
