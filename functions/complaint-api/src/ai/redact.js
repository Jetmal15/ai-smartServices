/**
 * Removes personal data from complaint text BEFORE it is sent to the AI provider.
 * The provider only ever needs to understand the problem, never who reported it. Replaced with neutral placeholders.
 * Best effort (free text can always hide a name or number): the AI payload also never includes the student's name,
 * roll number, e-mail, user ID, complaint ID or attachment.
 */

const digitCount = (text) => (text.match(/\d/g) ?? []).length

export function redact(text, { names = [] } = {}) {
  let count = 0
  const sub = (pattern, placeholder, test = () => true) => {
    text = text.replace(pattern, (match) => {
      if (!test(match)) return match
      count += 1
      return placeholder
    })
  }
  text = String(text ?? '')
  sub(/[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
  sub(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
  sub(/\b\d{5}-?\d{7}-?\d\b/g, '[id number]') // national ID (CNIC) format
  sub(/\+?\d[\d\s().-]{6,}\d/g, '[phone]', (m) => digitCount(m) >= 9)
  sub(/\b\d{2}[-\s]?[A-Za-z]{2,4}[-\s]?\d{2,4}\b/g, '[roll number]') // e.g. 22SW001, 22-SW-001
  for (const name of names) {
    for (const token of String(name ?? '').split(/\s+/)) {
      if (token.replace(/[^\p{L}]/gu, '').length < 3) continue
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      sub(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), '[name]')
    }
  }
  return { text, redactions: count }
}
