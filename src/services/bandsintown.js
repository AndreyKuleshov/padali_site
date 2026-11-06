/**
 * Концерты из Bandsintown.
 *
 * Даты и площадки заводят там — для афиш, трекеров и рассылки, — и
 * второй такой же список в админке неизбежно разъезжается с первым.
 * Поэтому здесь только чтение: сайт берёт расписание оттуда, а
 * своего добавляет ровно то, чего в Bandsintown нет, — афишу и цену.
 *
 * Наружу функция не бросает и не повторяет: отказ чужой службы не
 * касается посетителя, а в базе лежит последняя удачная копия —
 * та же политика, что у почты, отбивки и проверки контактов.
 *
 * Без ключа синхронизация просто выключена.
 */
import config from '../config.js'

const API = 'https://rest.bandsintown.com'

/** Настроена ли синхронизация? Без ключа ходить не с чем. */
export function isBandsintownConfigured (settings = config.bandsintown) {
  return Boolean(settings?.apiKey && settings?.artistId)
}

/**
 * Адрес без строки запроса.
 *
 * Bandsintown подставляет в возвращаемые ссылки наш же app_id
 * (проверено ответом: ключ встречается в нём дважды). Поставь такую
 * ссылку на страницу — и ключ окажется у всех на виду. Параметры
 * там только счётчики переходов, терять нечего.
 */
function stripQuery (url) {
  const text = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(text)) return ''
  const cut = text.search(/[?#]/)
  return cut === -1 ? text : text.slice(0, cut)
}

/**
 * Где купить билет. В offers лежат и продажа, и «напомнить», и
 * ссылка на RSVP; нужна первая, которая про билеты и доступна.
 */
function ticketUrl (offers) {
  const list = Array.isArray(offers) ? offers : []
  const sale = list.find((offer) => /ticket/i.test(String(offer?.type ?? '')) && offer?.url)
  return stripQuery((sale ?? list.find((offer) => offer?.url))?.url)
}

/** «2026-12-04T20:00:00» — ровно как прислали, без выдумки. */
function naiveTime (value) {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text) ? text : ''
}

/**
 * Событие API → строка нашей таблицы.
 *
 * Возвращает null, если не хватает того, без чего концерта нет:
 * собственного id и времени начала.
 */
export function normalizeEvent (raw) {
  const bitId = String(raw?.id ?? '').trim()
  const startsAt = naiveTime(raw?.starts_at) || naiveTime(raw?.datetime)
  if (bitId === '' || startsAt === '') return null

  const venue = raw?.venue ?? {}

  return {
    bitId,
    startsAt,
    /* У события бывает объявлен только день: правило показа так и
       говорит. Выдуманное «20:00» хуже, чем просто дата. */
    showTime: String(raw?.datetime_display_rule ?? 'datetime') !== 'date_only',
    venueName: String(venue.name ?? '').trim(),
    venueCity: String(venue.city ?? '').trim(),
    venueCountry: String(venue.country ?? '').trim(),
    venueAddress: String(venue.street_address ?? '').trim(),
    eventUrl: stripQuery(raw?.url),
    ticketUrl: ticketUrl(raw?.offers),
    soldOut: Boolean(raw?.sold_out),
    isFree: Boolean(raw?.free),
    description: String(raw?.description ?? '').trim()
  }
}

/**
 * Предстоящие концерты артиста.
 *
 * @returns {Promise<{ok: true, events: object[]} | {ok: false, error: string}>}
 */
export async function fetchEvents ({
  fetchImpl = fetch,
  settings = config.bandsintown
} = {}) {
  if (!isBandsintownConfigured(settings)) return { ok: false, error: 'не настроено' }

  /* Артист адресуется как `id_<номер>`: по голому номеру API
     отвечает 404 — проверено запросом. */
  const url = `${API}/artists/id_${encodeURIComponent(settings.artistId)}/events` +
    `?app_id=${encodeURIComponent(settings.apiKey)}&date=upcoming`

  let response
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(settings.timeoutMs ?? 8000)
    })
  } catch (error) {
    return { ok: false, error: `сеть: ${String(error?.message ?? error).slice(0, 200)}` }
  }

  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: 'ответ не разобрался' }
  }

  /* Не массив — значит, это не список концертов, а что угодно
     ещё: ошибка в обёртке, заглушка прокси, пустая страница. По
     такому ответу чистить базу нельзя. */
  if (!Array.isArray(payload)) return { ok: false, error: 'ответ не список' }

  return { ok: true, events: payload.map(normalizeEvent).filter(Boolean) }
}

export { stripQuery }
