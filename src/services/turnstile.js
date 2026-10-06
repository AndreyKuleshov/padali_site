/**
 * Проверка капчи Cloudflare Turnstile.
 *
 * Включается только когда заданы оба ключа. Нет ключей — формы
 * работают ровно как раньше: сайт не должен ломаться оттого, что
 * капчу ещё не завели, а разработка не должна требовать аккаунта.
 *
 * Политика при отказе сети та же, что у проверки контактов и по той
 * же причине: недостоверный ответ — не повод отказать. Потерять
 * настоящее письмо из-за того, что Cloudflare моргнул, хуже, чем
 * пропустить одно роботское. Приманка и ограничение частоты никуда
 * не делись и в эту минуту работают.
 *
 * А вот отсутствие токена — это не «сеть моргнула», это запрос мимо
 * формы. Такое отклоняем.
 */
import config from '../config.js'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Капча настроена? Без обоих ключей проверять нечем. */
function turnstileEnabled (keys = config.turnstile) {
  return Boolean(keys?.siteKey && keys?.secretKey)
}

/**
 * @param {string} token — значение cf-turnstile-response из формы
 * @param {object} options — fetchImpl и timeoutMs для тестов, ip
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function verifyTurnstile (token, { fetchImpl = fetch, timeoutMs = 6000, ip = '', keys = config.turnstile } = {}) {
  if (!turnstileEnabled(keys)) return { ok: true, reason: 'off' }

  const value = typeof token === 'string' ? token.trim() : ''
  if (value === '') return { ok: false, reason: 'missing' }

  const body = new URLSearchParams({ secret: keys.secretKey, response: value })
  if (ip) body.set('remoteip', ip)

  let response
  try {
    response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    return { ok: true, reason: 'unreachable' }
  }

  if (!response.ok) return { ok: true, reason: 'unreachable' }

  let result
  try {
    result = await response.json()
  } catch {
    return { ok: true, reason: 'unreachable' }
  }

  /* Ответ Cloudflare разобран — вот ему верим. Коды отказа кладём
     в лог: по ним видно, бот это или наша же ошибка в ключах. */
  return result?.success === true
    ? { ok: true }
    : { ok: false, reason: (result?.['error-codes'] ?? []).join(',') || 'rejected' }
}

export { verifyTurnstile, turnstileEnabled, VERIFY_URL }
