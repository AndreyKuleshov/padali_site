/**
 * Концерты: синхронизация с Bandsintown и экран правки.
 *
 * Главное правило здесь одно: заход синхронизации не трогает того,
 * что поставил редактор. Афишу и цену в Bandsintown взять негде,
 * их ставят руками, и обновление раз в час не вправе их стереть.
 *
 * Второе правило: отказ чужой службы не касается посетителя — на
 * странице остаётся последняя удачная копия из базы.
 *
 * В сеть тесты не ходят: fetchImpl и перевод приходят параметрами.
 */
import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage,
  closePool, addConcert
} from './helpers.js'
import { syncConcerts, lastSyncedAt } from '../src/services/concert-sync.js'
import { listEvents, listUpcomingEvents, textsForEvents } from '../src/repositories/concerts.js'
import { processUpload } from '../src/services/media-processor.js'
import { query } from '../src/db/pool.js'

let app
let session

beforeEach(async () => {
  await resetDatabase()
  if (!app) app = await createTestServer()
  await createTestAdmin()
  session = await loginAs(app)
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

const SETTINGS = { apiKey: 'КЛЮЧ', artistId: '15671864', timeoutMs: 1000 }
const silent = { info () {}, warn () {} }

function event (overrides = {}) {
  return {
    id: '109124617',
    url: 'https://www.bandsintown.com/e/109124617?app_id=КЛЮЧ',
    starts_at: '2099-12-04T20:00:00',
    description: 'A loud night in Belgrade',
    venue: { name: 'Kontrapunkt', city: 'Beograd', country: 'Serbia' },
    offers: [],
    sold_out: false,
    free: false,
    ...overrides
  }
}

function fetching (payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload })
}

/** Перевод-подделка: считает вызовы и отдаёт оба языка. */
function translator () {
  const calls = []
  const impl = async ({ text, locales }) => {
    calls.push(text)
    const translations = {}
    for (const locale of locales) {
      translations[locale.code] = locale.code === 'en' ? text : `[sr] ${text}`
    }
    return { ok: true, translations, source: 'en' }
  }
  impl.calls = calls
  return impl
}

const run = (payload, extra = {}) => syncConcerts({
  fetchImpl: fetching(payload),
  settings: SETTINGS,
  translateImpl: translator(),
  logger: silent,
  ...extra
})

test('заход записывает концерт и переводит его описание', async () => {
  const translate = translator()
  const result = await run([event()], { translateImpl: translate })

  assert.deepEqual(
    { ok: result.ok, fetched: result.fetched, translated: result.translated },
    { ok: true, fetched: 1, translated: 1 }
  )

  const [saved] = await listEvents()
  assert.equal(saved.bitId, '109124617')
  assert.equal(saved.startsAt, '2099-12-04T20:00:00')
  assert.equal(saved.date, '2099-12-04')
  assert.equal(saved.venueName, 'Kontrapunkt')
  assert.equal(saved.eventUrl, 'https://www.bandsintown.com/e/109124617',
    'ключ приложения в базу не попадает')

  const texts = (await textsForEvents([saved.id])).get(saved.id)
  assert.equal(texts.sr.description, '[sr] A loud night in Belgrade')
  assert.ok(await lastSyncedAt(), 'время удачного захода записано')
})

/*
 * Правило, ради которого разделены колонки: афишу и цену ставит
 * редактор, и обновление раз в час не вправе их стереть. Без этого
 * вся затея с «можно поставить свою афишу» живёт до первого часа.
 */
test('заход не трогает афишу и цену, поставленные редактором', async () => {
  await run([event()])
  const [before] = await listEvents()

  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 500, seed: 71 }),
    originalName: 'afisha.png', mime: 'image/png'
  })
  await app.inject({
    method: 'POST', url: `/admin/concerts/${before.id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      'media[poster][]': String(media.id),
      price: '700', price_currency: 'RSD', price_from: '1'
    })
  })

  // Второй заход: из Bandsintown приехало то же событие с правками.
  await run([event({ sold_out: true, venue: { name: 'Kontrapunkt', city: 'Novi Sad' } })])

  const [after] = await listEvents()
  assert.equal(after.id, before.id, 'строка та же, а не новая')
  assert.equal(after.posterId, media.id, 'афиша на месте')
  assert.equal(after.price, '700 RSD', 'цена на месте')
  assert.equal(after.priceFrom, true, 'и флажок «от» тоже')

  assert.equal(after.soldOut, true, 'а пришедшее из Bandsintown обновилось')
  assert.equal(after.venueCity, 'Novi Sad')
})

/* Отменённый концерт должен уйти со страницы сам — иначе о нём
   узнают от зрителей, пришедших к закрытой двери. */
test('концерт, которого больше нет в ответе, уходит из базы', async () => {
  await run([event(), event({ id: '2', starts_at: '2099-12-20T20:00:00' })])
  assert.equal((await listEvents()).length, 2)

  const result = await run([event()])
  assert.equal(result.removed, 1)
  assert.deepEqual((await listEvents()).map((row) => row.bitId), ['109124617'])
})

/*
 * Неудачный заход не меняет ничего. На странице в этот момент
 * висит расписание, и подчистить его по молчанию сети — худшее,
 * что можно сделать: раздел исчезнет целиком.
 */
test('отказ Bandsintown оставляет базу нетронутой', async () => {
  await run([event()])
  const before = await listEvents()

  for (const broken of [
    async () => { throw new Error('timeout') },
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => ({ error: 'Unknown Artist' }) })
  ]) {
    const result = await syncConcerts({
      fetchImpl: broken, settings: SETTINGS, translateImpl: translator(), logger: silent
    })
    assert.equal(result.ok, false)
    assert.deepEqual(await listEvents(), before, 'расписание осталось прежним')
  }
})

/* Перевод платный, и гонять его на каждом заходе незачем:
   заказываем только новое и изменившееся. */
test('описание переводится заново только когда оно изменилось', async () => {
  const translate = translator()

  await syncConcerts({ fetchImpl: fetching([event()]), settings: SETTINGS, translateImpl: translate, logger: silent })
  assert.equal(translate.calls.length, 1)

  await syncConcerts({ fetchImpl: fetching([event()]), settings: SETTINGS, translateImpl: translate, logger: silent })
  assert.equal(translate.calls.length, 1, 'то же описание второй раз не переводим')

  await syncConcerts({
    fetchImpl: fetching([event({ description: 'Другой текст' })]),
    settings: SETTINGS, translateImpl: translate, logger: silent
  })
  assert.deepEqual(translate.calls, ['A loud night in Belgrade', 'Другой текст'])
})

/* Модель не ответила — событие всё равно записано, а описание
   показывается на языке оригинала: это понятнее пустого места.
   Следующий заход попробует снова, потому что строк перевода так
   и нет. */
test('неудачный перевод не теряет ни события, ни описания', async () => {
  let attempts = 0
  const failing = async () => { attempts += 1; return { ok: false, reason: 'unreachable' } }

  await syncConcerts({ fetchImpl: fetching([event()]), settings: SETTINGS, translateImpl: failing, logger: silent })
  const [saved] = await listEvents()
  assert.equal(saved.description, 'A loud night in Belgrade')
  assert.equal((await textsForEvents([saved.id])).size, 0, 'переводов нет')

  await syncConcerts({ fetchImpl: fetching([event()]), settings: SETTINGS, translateImpl: failing, logger: silent })
  assert.equal(attempts, 2, 'следующий заход пробует снова')
})

test('без ключа синхронизация выключена и ничего не пишет', async () => {
  const result = await syncConcerts({
    fetchImpl: fetching([event()]),
    settings: { apiKey: '', artistId: '1' },
    translateImpl: translator(), logger: silent
  })
  assert.equal(result.ok, false)
  assert.deepEqual(await listEvents(), [])
})

/* ─── Экран правки ──────────────────────────────────────────── */

test('редактор ставит афишу и цену, остальное только показывается', async () => {
  const id = await addConcert({
    date: '2099-12-04', venue: 'Kontrapunkt', city: 'Beograd',
    description: 'A loud night', ticketUrl: 'https://tickets.example/x'
  })

  const page = (await app.inject({
    method: 'GET', url: '/admin/concerts', cookies: session.cookies
  })).body

  assert.match(page, /Kontrapunkt/)
  assert.match(page, /04\.12\.2099/)
  assert.match(page, /name="media\[poster\]\[\]"|media-field/, 'поле афиши есть')
  assert.match(page, /name="price"/, 'и поле цены')
  assert.doesNotMatch(page, /name="venue"|name="starts_at"/,
    'полей под то, что приходит из Bandsintown, нет')

  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 500, seed: 72 }),
    originalName: 'afisha-2.png', mime: 'image/png'
  })
  const response = await app.inject({
    method: 'POST', url: `/admin/concerts/${id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      'media[poster][]': String(media.id),
      price: '700', price_currency: 'RSD'
    })
  })
  assert.equal(response.statusCode, 302)

  const [saved] = await listEvents()
  assert.equal(saved.posterId, media.id)
  assert.equal(saved.price, '700 RSD')
  assert.equal(saved.venueName, 'Kontrapunkt', 'пришедшее из Bandsintown форма не тронула')
  assert.equal(saved.ticketUrl, 'https://tickets.example/x')
})

/* Афиша концерта — третья ссылка на файл медиатеки, после блоков и
   альбомов. Без её учёта медиатека звала бы её неиспользуемой и
   давала удалить вместе с файлами. */
test('афишу концерта медиатека считает используемой', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 500, seed: 73 }),
    originalName: 'afisha-3.png', mime: 'image/png'
  })
  const id = await addConcert({ date: '2099-12-04', posterId: media.id })
  assert.ok(id)

  const { mediaUsage, usageCounts } = await import('../src/repositories/media.js')
  const usage = await mediaUsage(media.id)
  assert.equal(usage.isUsed, true)
  assert.equal(usage.concerts.length, 1)
  assert.equal((await usageCounts([media.id])).get(media.id), 1)

  const response = await app.inject({
    method: 'POST', url: `/admin/media/${media.id}/delete`, cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })
  assert.equal(response.statusCode, 302)
  assert.equal((await query('SELECT id FROM media WHERE id = ?', [media.id])).length, 1,
    'файл не удалён')
})

test('кнопка «обновить сейчас» ходит за расписанием', async () => {
  await addConcert({ date: '2099-11-01', bitId: 'старый' })

  const response = await app.inject({
    method: 'POST', url: '/admin/concerts/refresh', cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })
  assert.equal(response.statusCode, 302)
  assert.equal(response.headers.location, '/admin/concerts')
})

/* Будущие концерты отбираются по дате, а не по времени начала:
   концерт держится на странице весь свой день. */
test('отбор будущих идёт по дню, а не по часу', async () => {
  await addConcert({ date: '2026-12-04', time: '09:00:00', bitId: 'утренний' })

  assert.equal((await listUpcomingEvents('2026-12-04')).length, 1, 'в свой день — на месте')
  assert.equal((await listUpcomingEvents('2026-12-05')).length, 0, 'назавтра уходит')
})
