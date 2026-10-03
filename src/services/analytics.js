import { createHmac } from 'node:crypto'
import config from '../config.js'

/**
 * Опознание посетителя без кук и без хранения адреса.
 *
 * Хеш считается от адреса и браузера с солью, в которую входит дата.
 * За сутки видно уникальных посетителей; завтра соль другая, и связать
 * вчерашний визит с сегодняшним нельзя — это осознанный предел.
 */
function visitorHash (request, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  const address = request.ip ?? ''
  const agent = String(request.headers['user-agent'] ?? '')
  return createHmac('sha256', config.sessionSecret)
    .update(`${day}|${address}|${agent}`)
    .digest('hex')
    .slice(0, 32)
}

const BOTS = /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|postman/i

function isBot (userAgent) {
  return BOTS.test(String(userAgent ?? ''))
}

/** Хост источника перехода; свой домен источником не считаем. */
function referrerHost (referrer) {
  if (!referrer) return null
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    const own = new URL(config.publicUrl).hostname.toLowerCase()
    return host === own ? null : host.slice(0, 190)
  } catch {
    return null
  }
}

/** В статистику попадают только пути самого сайта, без параметров. */
function normalizePath (value) {
  const path = String(value ?? '/').split('?')[0].split('#')[0]
  if (!path.startsWith('/') || path.startsWith('/admin') || path.startsWith('/uploads')) return null
  return path.length > 255 ? null : (path === '' ? '/' : path)
}

function clamp (value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback
}

/** Разбор пачки кликов из маячка: всё чужое отбрасываем молча. */
function parseClicks (raw, path) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 80).map((click) => ({
    path,
    // Долю шире страницы не подгоняем к единице: это мусор,
    // который сместил бы карту кликов.
    xRatio: Number(click?.x) >= 0 && Number(click?.x) <= 1 ? Number(click.x) : null,
    yOffset: Math.round(clamp(click?.y, 0, 200000, null)),
    viewport: Math.round(clamp(click?.w, 200, 10000, null)),
    target: click?.t ? String(click.t).slice(0, 190) : null
  })).filter((click) => click.xRatio !== null && Number.isFinite(click.yOffset) && Number.isFinite(click.viewport))
}

export { visitorHash, isBot, referrerHost, normalizePath, parseClicks, clamp }
