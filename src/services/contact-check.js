/**
 * Проверка контакта покупателя.
 *
 * Три вида связи ведут себя по-разному, и притворяться, что они
 * одинаковы, нечестно:
 *
 *   email     — проверяется формой записи, этого достаточно;
 *   telegram  — t.me отдаёт страницу профиля, по ней видно,
 *               существует ли имя;
 *   instagram — без авторизации не проверить: на выдуманное имя
 *               приходит та же оболочка, что и на настоящее, —
 *               проверено. Поэтому только формат.
 *
 * Правило на все случаи: недостоверный ответ не повод отказать.
 * Потерять настоящего покупателя из-за того, что сеть моргнула,
 * хуже, чем принять заказ с опечаткой.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const TELEGRAM = /^[A-Za-z][A-Za-z0-9_]{3,31}$/
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/

export const CONTACT_KINDS = ['email', 'telegram', 'instagram']

/** Имя профиля из «@name», «t.me/name» или полной ссылки. */
export function normalizeHandle (value) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .split(/[?#]/)[0]
}

/** Как контакт выглядит в письме и в списке сообщений. */
export function formatContact (kind, value) {
  if (kind === 'email') return String(value ?? '').trim()
  const handle = normalizeHandle(value)
  return `${kind === 'telegram' ? 'Telegram' : 'Instagram'}: @${handle}`
}

/** Форма записи. Сеть не трогаем. */
export function looksValid (kind, value) {
  if (kind === 'email') return EMAIL.test(String(value ?? '').trim())
  const handle = normalizeHandle(value)
  if (kind === 'telegram') return TELEGRAM.test(handle)
  if (kind === 'instagram') return INSTAGRAM.test(handle)
  return false
}

/**
 * Существует ли профиль. Только для telegram; остальным — true.
 * @returns {Promise<boolean>}
 */
async function profileExists (kind, handle, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  if (kind !== 'telegram') return true

  let response
  try {
    response = await fetchImpl(`https://t.me/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; padali-site)' }
    })
  } catch {
    return true // сеть не ответила — это не вина покупателя
  }

  if (!response.ok) return true
  let html
  try {
    html = await response.text()
  } catch {
    return true
  }

  /* На несуществующее имя t.me отдаёт тот же код 200, но без
     карточки профиля — её и ищем. */
  return html.includes('tgme_page_title')
}

/**
 * @returns {Promise<{ok: true, contact: string} | {ok: false, reason: 'kind'|'format'|'missing'}>}
 */
export async function checkContact (kind, value, options = {}) {
  if (!CONTACT_KINDS.includes(kind)) return { ok: false, reason: 'kind' }
  if (!looksValid(kind, value)) return { ok: false, reason: 'format' }

  const handle = kind === 'email' ? String(value).trim() : normalizeHandle(value)
  if (!await profileExists(kind, handle, options)) return { ok: false, reason: 'missing' }

  return { ok: true, contact: formatContact(kind, value) }
}
