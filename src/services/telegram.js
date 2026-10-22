/**
 * Отбивка в Telegram о сообщении с сайта.
 *
 * Зачем вдобавок к письму: письмо читают, когда садятся за почту, а
 * заказ мерча и вопрос с концерта хочется видеть сразу. Почта при
 * этом остаётся главной — она хранит, Telegram только окликает.
 *
 * Сообщение к моменту вызова уже лежит в базе, поэтому здесь нет ни
 * исключений наружу, ни повторов: не ушло — значит не ушло, в
 * админке оно всё равно видно. Политика та же, что у mail.js и у
 * проверки контактов: отказ чужой службы не касается посетителя.
 *
 * Без токена и адресата отбивка просто выключена, и сайт работает
 * ровно так же.
 */
import config from '../config.js'

const API = 'https://api.telegram.org'

/** Настроена ли отбивка? Без обоих значений слать некуда и нечем. */
export function isTelegramConfigured (settings = config.telegram) {
  return Boolean(settings?.token && settings?.chatId)
}

/*
 * Разметку не используем вовсе.
 *
 * В сообщении человеческий текст: в нём бывают и звёздочки, и
 * подчёркивания, и угловые скобки. С parse_mode Telegram на таком
 * отвечает отказом — то есть сломать отбивку мог бы любой
 * посетитель, просто написав «*» в поле. Без parse_mode текст
 * уходит как есть и экранировать нечего.
 */
function compose (message, { siteUrl }) {
  const title = message.kind === 'order' ? 'Заказ мерча' : 'Сообщение с сайта'
  const lines = [title, '']

  if (message.item) lines.push(`Товар: ${message.item}`)
  if (message.city) lines.push(`Город: ${message.city}`)
  if (message.contact) lines.push(`Связь: ${message.contact}`)
  if (message.body) lines.push('', message.body)

  /* Ссылка на админку последней строкой: отбивку читают с телефона,
     и отвечать всё равно идти туда. */
  if (siteUrl) lines.push('', `${siteUrl}/admin/messages`)

  return lines.join('\n')
}

/**
 * @param {object} message — то же, что ушло в базу
 * @param {object} options — fetchImpl и timeoutMs для тестов
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function notifyTelegram (message, {
  fetchImpl = fetch,
  timeoutMs = config.telegram?.timeoutMs ?? 6000,
  settings = config.telegram,
  siteUrl = config.publicUrl
} = {}) {
  if (!isTelegramConfigured(settings)) return { ok: true, error: undefined }

  let response
  try {
    response = await fetchImpl(`${API}/bot${settings.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.chatId,
        text: compose(message, { siteUrl }),
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    return { ok: false, error: `сеть: ${String(error?.message ?? error).slice(0, 200)}` }
  }

  if (response.ok) return { ok: true }

  /* Текст отказа кладём в лог: по нему видно, протух ли токен,
     выгнали ли бота из чата или мы ошиблись в адресате. */
  let detail = `HTTP ${response.status}`
  try {
    const body = await response.json()
    if (body?.description) detail += `: ${String(body.description).slice(0, 200)}`
  } catch {
    // Тело не разобралось — хватит и кода ответа.
  }
  return { ok: false, error: detail }
}

export { compose as composeTelegram }
