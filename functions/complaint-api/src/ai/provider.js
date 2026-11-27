
/**
 * The ONLY place that talks to the external AI provider.
 * The API key stays inside the Appwrite Function environment.
 *
 * Supported providers:
 * - openai
 * - anthropic
 * - gemini
 *
 * fetch and sleep are injectable for testing.
 */

export class ProviderError extends Error {
  constructor(kind, message, { retryAfterMs } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.retryAfterMs = retryAfterMs
  }
}


const DEFAULTS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
  },
}


const MAX_RETRY_WAIT_MS = 5000
const MAX_OUTPUT_TOKENS = 500

export function providerConfigFromEnv(env) {
  const provider = String(env.AI_PROVIDER || 'openai').toLowerCase()

  return {
    provider,
    // apiKey: String(env.AI_API_KEY || '').trim(),
    apiKey: String(
  provider === 'groq'
    ? env.GROQ_API_KEY || ''
    : env.AI_API_KEY || ''
).trim(),
    model: String(env.AI_MODEL || '').trim(),
    baseUrl: String(
      env.AI_BASE_URL || DEFAULTS[provider]?.baseUrl || ''
    ).replace(/\/+$/, ''),
    timeoutMs: Math.min(
      Math.max(Number.parseInt(env.AI_TIMEOUT_MS, 10) || 15000, 1000),
      25000
    ),
    enabled: String(env.AI_ENABLED ?? 'true').toLowerCase() !== 'false',
  }
}

/** Retry-After header: seconds or HTTP date -> milliseconds. */
function retryAfterMs(response) {
  const raw = response.headers?.get?.('retry-after')

  if (!raw) return undefined

  const seconds = Number(raw)

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const date = Date.parse(raw)

  return Number.isNaN(date)
    ? undefined
    : Math.max(0, date - Date.now())
}

export function createProvider(
  config,
  {
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) {
  const supported = ['openai', 'anthropic', 'gemini', 'groq'].includes(config.provider)

  const configured = Boolean(
    config.enabled &&
    supported &&
    config.apiKey &&
    config.model &&
    config.baseUrl
  )

  const label = `${config.provider}:${config.model}`

  function buildRequest({ system, user }) {

    // Gemini API
    if (config.provider === 'gemini') {
      return {
        url: `${config.baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        headers: {
          'x-goog-api-key': config.apiKey,
          'content-type': 'application/json',
        },
        body: {
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: user }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
          },
        },
      }
    }

    // Anthropic API
    if (config.provider === 'anthropic') {
      return {
        url: `${config.baseUrl}/v1/messages`,
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: {
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          system,
          messages: [
            {
              role: 'user',
              content: user,
            },
          ],
        },
      }
    }

    // OpenAI-compatible API
    return {
      url: `${config.baseUrl}/chat/completions`,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: {
        model: config.model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: system,
          },
          {
            role: 'user',
            content: user,
          },
        ],
      },
    }
  }

  function extractText(json) {

    // Gemini response
    if (config.provider === 'gemini') {
      const parts = json?.candidates?.[0]?.content?.parts

      return Array.isArray(parts)
        ? parts
            .map((part) => typeof part.text === 'string' ? part.text : '')
            .join('')
        : ''
    }

    // Anthropic response
    if (config.provider === 'anthropic') {
      const parts = Array.isArray(json?.content)
        ? json.content.filter(
            (part) => part?.type === 'text' && typeof part.text === 'string'
          )
        : []

      return parts.map((part) => part.text).join('')
    }

    // OpenAI response
    const content = json?.choices?.[0]?.message?.content

    return typeof content === 'string' ? content : ''
  }

  /** One HTTP call. Error messages never contain the API key or response body. */
  async function callOnce(prompt) {
    const request = buildRequest(prompt)

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      config.timeoutMs
    )

    let response

    try {
      response = await fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new ProviderError(
          'timeout',
          'The AI provider did not answer in time.'
        )
      }

      throw new ProviderError(
        'unavailable',
        'The AI provider could not be reached.'
      )
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 429) {
      throw new ProviderError(
        'rate_limit',
        'The AI provider is rate limiting requests.',
        { retryAfterMs: retryAfterMs(response) }
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        'auth',
        'The AI provider rejected the credentials.'
      )
    }

    if (response.status >= 500) {
  throw new ProviderError(
    'unavailable',
    `The AI provider is temporarily unavailable (HTTP ${response.status}).`
  )
}

    if (!response.ok) {
      throw new ProviderError(
        'bad_response',
        `The AI provider refused the request (HTTP ${response.status}).`
      )
    }

    let json

    try {
      json = await response.json()
    } catch {
      throw new ProviderError(
        'bad_response',
        'The AI provider returned an unreadable response.'
      )
    }

    const text = extractText(json)

    if (!text.trim()) {
      throw new ProviderError(
        'bad_response',
        'The AI provider returned an empty answer.'
      )
    }

    return text
  }

  return {
    configured,
    label,
    name: config.provider,

    /**
     * Sends { system, user } and returns answer text.
     * Retries timeouts, 5xx and short rate limits once.
     */
    async complete(prompt) {
      if (!configured) {
        throw new ProviderError(
          'not_configured',
          'The AI provider is not configured.'
        )
      }

      try {
        return await callOnce(prompt)
      } catch (error) {
        if (!(error instanceof ProviderError)) {
          throw error
        }

        const retryable =
          error.kind === 'timeout' ||
          error.kind === 'unavailable' ||
          (
            error.kind === 'rate_limit' &&
            (error.retryAfterMs ?? 1000) <= MAX_RETRY_WAIT_MS
          )

        if (!retryable) {
          throw error
        }

        await sleep(
          error.kind === 'rate_limit'
            ? (error.retryAfterMs ?? 1000)
            : 500
        )

        return callOnce(prompt)
      }
    },
  }
}
