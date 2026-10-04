/**
 * Письма с сайта.
 *
 * Сообщение уже лежит в базе, когда сюда приходит очередь: почта
 * отвечает не всегда, а написанное человеком терять нельзя. Поэтому
 * здесь нет ни исключений наружу, ни повторов — только отчёт о том,
 * ушло или нет, который ложится в ту же строку.
 *
 * Без SMTP_HOST отправка просто выключена: сообщения копятся в
 * админке, и сайт работает ровно так же.
 */
import nodemailer from 'nodemailer'
import config from '../config.js'

let cached = null

export function isMailConfigured (settings = config.mail) {
  return Boolean(settings.host && settings.to)
}

function transport (settings) {
  if (cached) return cached
  cached = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 — TLS с первого байта, остальные порты поднимают STARTTLS.
    secure: settings.port === 465,
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined
  })
  return cached
}

/** Только для тестов: настройки читаются один раз на процесс. */
export function resetTransport () {
  cached = null
}

/**
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function sendMessage (message, {
  settings = config.mail, transporter = null
} = {}) {
  if (!isMailConfigured(settings)) return { ok: false, error: 'mail not configured' }

  /* Письмо на английском: ящик у группы один, читают его вместе,
     и общий язык сайта тут уместнее языка разработки. Сам текст
     посетителя не трогаем — он как написан. */
  const lines = []
  if (message.item) lines.push(`Item: ${message.item}`)
  if (message.city) lines.push(`City: ${message.city}`)
  if (message.contact) lines.push(`Contact: ${message.contact}`)
  if (message.locale) lines.push(`Page language: ${message.locale}`)
  if (lines.length > 0) lines.push('')
  if (message.body) lines.push(message.body)

  const subject = message.kind === 'order'
    ? `Merch order${message.item ? `: ${message.item}` : ''}`
    : 'Message from the site'

  try {
    await (transporter ?? transport(settings)).sendMail({
      from: settings.from,
      to: settings.to,
      /* Отвечать нужно человеку, а не самому себе. Подставляем
         только похожее на адрес: в поле связи пишут и телеграм. */
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.contact ?? '') ? message.contact : undefined,
      subject,
      text: lines.join('\n')
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 500) }
  }
}
