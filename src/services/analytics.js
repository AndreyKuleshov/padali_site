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

/**
 * В статистику попадают только пути самого сайта, без параметров.
 *
 * Отдельно отбрасываются `//host` и `/\host`: браузер читает их как
 * адрес чужого сайта, а путь отсюда попадает в src фрейма на
 * странице статистики — админ грузил бы чужую страницу внутри
 * админки. Служебные префиксы сверяем без учёта регистра: `/ADMIN`
 * ведёт туда же, куда `/admin`.
 */
function normalizePath (value) {
  const path = String(value ?? '/').split('?')[0].split('#')[0]
  if (!path.startsWith('/')) return null
  if (path.startsWith('//') || path.startsWith('/\\')) return null

  const lower = path.toLowerCase()
  if (lower.startsWith('/admin') || lower.startsWith('/uploads')) return null

  return path.length > 255 ? null : path
}

/**
 * Число внутри диапазона или NaN. Для координат клика именно так:
 * подогнать значение к границе значило бы нарисовать на карте точку
 * там, где никто не нажимал.
 */
/**
 * Якорь клика: число — ссылка на блок, слово — служебная область
 * вне блоков. Всё прочее отбрасывается.
 */
function splitAnchor (value) {
  const raw = String(value ?? '')
  if (/^\d{1,9}$/.test(raw)) return { blockId: Number(raw), anchor: null }
  if (/^[a-z][a-z0-9-]{0,31}$/.test(raw)) return { blockId: null, anchor: raw }
  return { blockId: null, anchor: null }
}

function inRange (value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : NaN
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
    // Якорь — либо идентификатор блока, либо служебное имя вроде
    // header: в базе это разные колонки, связь с блоком настоящая.
    ...splitAnchor(click?.b),
    // Пиксели от центра блока по горизонтали и от его верха по вертикали.
    xOffset: Math.round(inRange(click?.x, -5000, 5000)),
    yOffset: Math.round(inRange(click?.y, -5000, 200000)),
    viewport: Math.round(inRange(click?.w, 200, 10000)),
    target: click?.t ? String(click.t).slice(0, 190) : null
  })).filter((click) => (
    (click.blockId !== null || click.anchor !== null) &&
    Number.isFinite(click.xOffset) &&
    Number.isFinite(click.yOffset) &&
    Number.isFinite(click.viewport)
  ))
}

export {
  visitorHash, isBot, referrerHost, normalizePath, parseClicks,
  splitAnchor, clamp, inRange
}
