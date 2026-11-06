/**
 * Концерты: то, что пришло из Bandsintown, и то, что добавил редактор.
 *
 * Разделение проходит прямо по функциям. `upsertEvent` пишет
 * колонки источника и не упоминает афишу и цену — ни при вставке,
 * ни при обновлении; `setEventFields` пишет только их. Форма, которая
 * знает не всё, не должна писать «всё целиком»: иначе синхронизация
 * раз в час стирала бы то, что редактор поставил руками.
 */
import { db, placeholders, groupTexts, replaceTexts } from './helpers.js'

/** Колонки, которыми распоряжается синхронизация. */
const SOURCE_COLUMNS = [
  'starts_at', 'show_time',
  'venue_name', 'venue_city', 'venue_country', 'venue_address',
  'event_url', 'ticket_url', 'sold_out', 'is_free', 'description'
]

function sourceValues (event) {
  return [
    event.startsAt, event.showTime,
    event.venueName, event.venueCity, event.venueCountry, event.venueAddress,
    event.eventUrl, event.ticketUrl, event.soldOut, event.isFree, event.description
  ]
}

function hydrate (row) {
  if (!row) return null
  return {
    id: row.id,
    bitId: row.bit_id,
    startsAt: row.starts_at,
    /* Дата отдельно от времени: по ней сравнивают «сегодня» и её
       же печатает formatDate. */
    date: row.starts_at.slice(0, 10),
    time: row.show_time ? row.starts_at.slice(11, 16) : '',
    showTime: row.show_time,
    venueName: row.venue_name,
    venueCity: row.venue_city,
    venueCountry: row.venue_country,
    venueAddress: row.venue_address,
    eventUrl: row.event_url,
    ticketUrl: row.ticket_url,
    soldOut: row.sold_out,
    isFree: row.is_free,
    description: row.description,
    posterId: row.poster_id,
    price: row.price,
    priceFrom: row.price_from,
    syncedAt: row.synced_at
  }
}

const COLUMNS = 'id, bit_id, starts_at, show_time, venue_name, venue_city, venue_country, ' +
  'venue_address, event_url, ticket_url, sold_out, is_free, description, ' +
  'poster_id, price, price_from, synced_at'

/**
 * Будущие концерты по возрастанию даты.
 *
 * «Будущие» считаются от переданного дня, а не от часов машины:
 * день уже стоит в ключе кэша страницы, и решать по разным часам
 * нельзя — разметка и кэш разойдутся на полуночи.
 *
 * Сравнение строк работает как есть: «2026-12-04T20:00:00» больше
 * «2026-12-04» и меньше «2026-12-05». Концерт держится на странице
 * весь свой день, как держался у прежнего повторителя.
 */
async function listUpcomingEvents (today, conn) {
  const rows = await db(conn).all(
    `SELECT ${COLUMNS} FROM concert_events WHERE starts_at >= ? ORDER BY starts_at`,
    [today]
  )
  return rows.map(hydrate)
}

/** Все события, ближайшие сверху: список для админки. */
async function listEvents (conn) {
  const rows = await db(conn).all(`SELECT ${COLUMNS} FROM concert_events ORDER BY starts_at`)
  return rows.map(hydrate)
}

async function getEvent (id, conn) {
  return hydrate(await db(conn).one(`SELECT ${COLUMNS} FROM concert_events WHERE id = ?`, [id]))
}

/** Переводы событий: { [id]: { [locale]: { [field]: value } } }. */
async function textsForEvents (ids, conn) {
  if (ids.length === 0) return new Map()
  const rows = await db(conn).all(
    'SELECT event_id, locale, field, value FROM concert_event_texts ' +
    `WHERE event_id IN (${placeholders(ids.length)})`,
    ids
  )
  return groupTexts(rows, 'event_id')
}

/** Что уже лежит в базе: Map<bitId, {id, description}>. */
async function eventsByBitId (conn) {
  const rows = await db(conn).all('SELECT id, bit_id, description FROM concert_events')
  return new Map(rows.map((row) => [row.bit_id, { id: row.id, description: row.description }]))
}

/**
 * Записать событие источника. Афиша и цена не перечислены ни в
 * колонках вставки, ни в SET — синхронизация их не видит и не трёт.
 */
async function upsertEvent (event, conn) {
  const row = await db(conn).one(
    `INSERT INTO concert_events (bit_id, ${SOURCE_COLUMNS.join(', ')}, synced_at)
     VALUES (?, ${placeholders(SOURCE_COLUMNS.length)}, now())
     ON CONFLICT (bit_id) DO UPDATE SET
       ${SOURCE_COLUMNS.map((column) => `${column} = EXCLUDED.${column}`).join(', ')},
       synced_at = now()
     RETURNING id`,
    [event.bitId, ...sourceValues(event)]
  )
  return row?.id ?? null
}

/**
 * Убрать всё, чего нет в последнем удачном ответе.
 *
 * Отменённый концерт должен уйти со страницы сам — иначе редактор
 * узнает о нём от зрителей, пришедших к закрытой двери. Вызывать
 * это можно только после разобранного ответа-списка: по ошибке
 * сети база не чистится.
 */
async function deleteEventsExcept (bitIds, conn) {
  const runner = db(conn)
  if (bitIds.length === 0) {
    const result = await runner.run('DELETE FROM concert_events')
    return result.rowCount
  }
  const result = await runner.run(
    `DELETE FROM concert_events WHERE bit_id NOT IN (${placeholders(bitIds.length)})`,
    bitIds
  )
  return result.rowCount
}

/**
 * Поля редактора — и только они.
 *
 * Пустая цена пишется пустой строкой: это «цены нет», а не «не
 * трогай». Афиши нет — NULL.
 */
async function setEventFields (id, { posterId, price, priceFrom }, conn) {
  await db(conn).run(
    'UPDATE concert_events SET poster_id = ?, price = ?, price_from = ? WHERE id = ?',
    [Number.isInteger(posterId) && posterId > 0 ? posterId : null, price ?? '', Boolean(priceFrom), id]
  )
}

async function replaceEventTexts (id, textsByLocale, conn) {
  await replaceTexts(conn, {
    table: 'concert_event_texts', idColumn: 'event_id', id, textsByLocale
  })
}

export {
  listUpcomingEvents, listEvents, getEvent, textsForEvents,
  eventsByBitId, upsertEvent, deleteEventsExcept,
  setEventFields, replaceEventTexts
}
