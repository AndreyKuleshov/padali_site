/**
 * Чтение расписания из Bandsintown.
 *
 * Политика та же, что у почты, отбивки и проверки контактов: отказ
 * чужой службы не касается посетителя. Здесь это значит, что
 * функция не бросает ни при какой форме ответа, а вызывающий по
 * `ok` видит, можно ли доверять списку.
 *
 * В сеть тесты не ходят: fetchImpl приходит параметром.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchEvents, normalizeEvent, stripQuery, isBandsintownConfigured
} from '../src/services/bandsintown.js'

const SETTINGS = { apiKey: 'КЛЮЧ', artistId: '15671864', timeoutMs: 1000 }

/** Подделка fetch: запоминает запрос и отдаёт заданный ответ. */
function fakeFetch (reply) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    if (reply instanceof Error) throw reply
    return reply
  }
  impl.calls = calls
  return impl
}

const okReply = (payload) => ({ ok: true, status: 200, json: async () => payload })

/* Ровно то, что присылает живой API: время без смещения, площадка
   отдельным объектом, ключ приложения — внутри возвращаемых ссылок. */
const RAW = {
  id: '109124617',
  url: 'https://www.bandsintown.com/e/109124617?app_id=КЛЮЧ&came_from=267',
  datetime: '2026-12-04T20:00:00',
  starts_at: '2026-12-04T20:00:00',
  description: 'A loud night in Belgrade',
  venue: {
    name: 'Kontrapunkt', city: 'Beograd', country: 'Serbia',
    street_address: 'Bulevar despota Stefana 68b'
  },
  offers: [],
  free: false,
  sold_out: false,
  datetime_display_rule: 'datetime'
}

test('без ключа или артиста чтение выключено', async () => {
  const impl = fakeFetch(okReply([]))

  for (const settings of [{ apiKey: '', artistId: '1' }, { apiKey: 'x', artistId: '' }, {}]) {
    assert.equal(isBandsintownConfigured(settings), false)
    const result = await fetchEvents({ fetchImpl: impl, settings })
    assert.equal(result.ok, false)
  }

  assert.equal(impl.calls.length, 0, 'в сеть не ходили ни разу')
})

/* Артист адресуется как `id_<номер>`: по голому номеру живой API
   отвечает 404 — проверено запросом. */
test('запрос идёт за предстоящими концертами артиста по id_<номер>', async () => {
  const impl = fakeFetch(okReply([RAW]))
  const result = await fetchEvents({ fetchImpl: impl, settings: SETTINGS })

  assert.equal(result.ok, true)
  const { url, options } = impl.calls[0]
  assert.match(url, /\/artists\/id_15671864\/events\?/)
  assert.match(url, /date=upcoming/, 'прошедшие концерты не запрашиваем вовсе')
  assert.match(url, /app_id=%D0%9A%D0%9B%D0%AE%D0%A7/, 'ключ уходит параметром app_id')
  assert.ok(options.signal, 'у сетевого вызова есть таймаут')
})

/* Bandsintown подставляет наш же app_id в каждую возвращаемую
   ссылку. Поставь такую на страницу — и ключ окажется у всех на
   виду; параметры там только счётчики переходов. */
test('ключ приложения не доезжает до ссылок события', () => {
  const event = normalizeEvent({
    ...RAW,
    offers: [{ type: 'Tickets', url: 'https://tickets.example/x?app_id=КЛЮЧ' }]
  })

  assert.equal(event.eventUrl, 'https://www.bandsintown.com/e/109124617')
  assert.equal(event.ticketUrl, 'https://tickets.example/x')
  assert.doesNotMatch(JSON.stringify(event), /app_id|КЛЮЧ/)
})

test('адрес без схемы не проходит вовсе', () => {
  assert.equal(stripQuery('javascript:alert(1)'), '')
  assert.equal(stripQuery('tickets.example/x'), '')
  assert.equal(stripQuery(null), '')
  assert.equal(stripQuery('https://a.test/b#top'), 'https://a.test/b')
})

/* В offers лежат и продажа, и «напомнить», и RSVP. Нужна первая,
   которая про билеты. */
test('из предложений берётся продажа билетов, а не напоминание', () => {
  const event = normalizeEvent({
    ...RAW,
    offers: [
      { type: 'Reminder', url: 'https://remind.example/x' },
      { type: 'Tickets', url: 'https://tickets.example/real' }
    ]
  })
  assert.equal(event.ticketUrl, 'https://tickets.example/real')
})

/* У события бывает объявлен только день. Выдуманное «20:00» хуже,
   чем просто дата. */
test('время показывается только когда оно объявлено', () => {
  assert.equal(normalizeEvent(RAW).showTime, true)
  assert.equal(normalizeEvent({ ...RAW, datetime_display_rule: 'date_only' }).showTime, false)
})

test('событие без id или без времени отбрасывается', () => {
  assert.equal(normalizeEvent({ ...RAW, id: '' }), null)
  assert.equal(normalizeEvent({ ...RAW, starts_at: '', datetime: '' }), null)
  assert.equal(normalizeEvent({ ...RAW, starts_at: '4 декабря', datetime: '' }), null,
    'время не того вида — не время')
})

/* Молчащая сеть, пятисотка и ответ не того вида — три разные
   беды, и ни одна не должна превратиться в исключение: на
   странице в этот момент висит последняя удачная копия. */
test('ни один отказ не превращается в исключение', async () => {
  const cases = [
    [fakeFetch(new Error('timeout')), /сеть/],
    [fakeFetch({ ok: false, status: 503, json: async () => ({}) }), /503/],
    [fakeFetch({ ok: true, status: 200, json: async () => { throw new Error('не json') } }), /не разобрался/],
    [fakeFetch(okReply({ error: 'Unknown Artist' })), /не список/]
  ]

  for (const [impl, expected] of cases) {
    const result = await fetchEvents({ fetchImpl: impl, settings: SETTINGS })
    assert.equal(result.ok, false)
    assert.match(result.error, expected)
    assert.equal(result.events, undefined, 'списка нет — чистить базу нечем')
  }
})
