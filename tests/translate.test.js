/**
 * Перевод полей админки.
 *
 * К модели в тестах не ходим: подменяем fetch. Проверяем не
 * качество перевода, а то, что ответ разобран, частичный ответ не
 * теряет остального, а отказ отличается от недоступности — в
 * интерфейсе это разные сообщения.
 */
import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, closePool
} from './helpers.js'
import { translate, isConfigured, toLatin } from '../src/services/translate.js'
import { render } from '../src/services/renderer.js'
import { adminTranslator } from '../src/i18n/admin.js'

const SETTINGS = {
  apiKey: 'test-key',
  model: 'gpt-4.1-mini',
  baseUrl: 'https://api.openai.test/v1',
  timeoutMs: 1000
}

const LOCALES = [{ code: 'en', title: 'English' }, { code: 'sr', title: 'Srpski' }]

/** Ответ OpenAI в том виде, в каком его разбирает сервис. */
function reply (status, content, capture) {
  return async (url, init) => {
    if (capture) capture.url = url
    if (capture) capture.body = JSON.parse(init.body)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content } }] })
    }
  }
}

let app
let auth

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  app = await createTestServer()
  auth = await loginAs(app)
})

after(async () => { await closePool() })

test('перевод разбирается и возвращается по языкам', async () => {
  const seen = {}
  const result = await translate(
    { text: 'Слушайте наш новый сингл', locales: LOCALES },
    { fetchImpl: reply(200, '{"en":"Listen to our new single","sr":"Slušajte naš novi singl"}', seen), settings: SETTINGS }
  )

  assert.deepEqual(result, {
    ok: true,
    translations: { en: 'Listen to our new single', sr: 'Slušajte naš novi singl' }
  })
  assert.equal(seen.url, 'https://api.openai.test/v1/chat/completions')
  assert.equal(seen.body.model, 'gpt-4.1-mini')
  assert.equal(seen.body.temperature, 0, 'перевод не место для выдумки')
})

/** Один язык пропал — остальные терять незачем. */
test('частичный ответ не отбрасывается целиком', async () => {
  const result = await translate(
    { text: 'Фотографии', locales: LOCALES },
    { fetchImpl: reply(200, '{"en":"Photos"}'), settings: SETTINGS }
  )

  assert.deepEqual(result, { ok: true, translations: { en: 'Photos' } })
})

test('пустой текст до сети не доходит', async () => {
  let called = false
  const result = await translate(
    { text: '   ', locales: LOCALES },
    { fetchImpl: async () => { called = true }, settings: SETTINGS }
  )

  assert.deepEqual(result, { ok: false, reason: 'empty' })
  assert.equal(called, false)
})

test('без ключа сервис не вызывается', async () => {
  let called = false
  const result = await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: async () => { called = true }, settings: { ...SETTINGS, apiKey: '' } }
  )

  assert.deepEqual(result, { ok: false, reason: 'not_configured' })
  assert.equal(called, false)
  assert.equal(isConfigured({ ...SETTINGS, apiKey: '' }), false)
})

/** Исчерпанная квота — это про счёт, а не про текст. */
test('отказ сервиса отличается от недоступности', async () => {
  for (const status of [401, 403, 429]) {
    const result = await translate(
      { text: 'Фото', locales: LOCALES },
      { fetchImpl: reply(status, ''), settings: SETTINGS }
    )
    assert.deepEqual(result, { ok: false, reason: 'refused' }, `код ${status}`)
  }

  const broken = await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: reply(500, ''), settings: SETTINGS }
  )
  assert.deepEqual(broken, { ok: false, reason: 'unreachable' })
})

test('упавшая сеть не роняет запрос', async () => {
  const result = await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: async () => { throw new Error('ENOTFOUND') }, settings: SETTINGS }
  )
  assert.deepEqual(result, { ok: false, reason: 'unreachable' })
})

test('мусор вместо JSON не ломает разбор', async () => {
  const result = await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: reply(200, 'Photos'), settings: SETTINGS }
  )
  assert.deepEqual(result, { ok: false, reason: 'unreachable' })
})

test('в запросе перечислены языки сайта с человеческими названиями', async () => {
  const seen = {}
  await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: reply(200, '{"en":"Photos","sr":"Fotografije"}', seen), settings: SETTINGS }
  )

  const prompt = seen.body.messages[1].content
  assert.match(prompt, /"en": English/)
  assert.match(prompt, /"sr": Serbian/)
  assert.match(prompt, /Фото/)
})

/* ─── Разметка и маршрут ─────────────────────────────────── */

test('без ключа кнопок перевода в админке нет', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin/settings', cookies: auth.cookies })

  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /data-translate-run/,
    'в тестовом окружении ключа нет — кнопки быть не должно')
  assert.match(response.body, /name="text\[en\]\[title\]"/, 'языковые поля на месте')
  assert.match(response.body, /name="text\[sr\]\[title\]"/)
})

test('маршрут перевода без ключа отвечает понятно, а не падает', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/translate.json',
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, text: 'Фото' }
  })

  assert.equal(response.statusCode, 503)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.reason, 'not_configured')
  assert.match(body.message, /OPENAI_API_KEY/)
})

test('перевод закрыт для неавторизованных', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/translate.json',
    payload: { text: 'Фото' }
  })

  assert.notEqual(response.statusCode, 200)
})

/** Разметку с ключом проверяем на партиале: конфиг читается при импорте. */
test('с ключом появляется поле исходника и кнопка', () => {
  const t = adminTranslator('en')

  const on = render('admin/partials/translate-row', { canTranslate: true, t })
  assert.match(on, /data-translate-source/)
  assert.match(on, /data-translate-run/)
  assert.match(on, /Translate/)
  assert.match(on, /hidden/, 'кнопка скрыта, пока нечего переводить')

  const off = render('admin/partials/translate-row', { canTranslate: false, t })
  assert.equal(off.trim(), '')
})

test('строка перевода переведена и сама', () => {
  const sr = render('admin/partials/translate-row', { canTranslate: true, t: adminTranslator('sr') })
  assert.match(sr, /Prevedi/)
})

/* ─── Сербская латиница ──────────────────────────────────── */

test('кириллица перекладывается в сербскую латиницу', () => {
  assert.equal(toLatin('Слушајте наш нови сингл'), 'Slušajte naš novi singl')
  assert.equal(toLatin('Фотографије'), 'Fotografije')
  assert.equal(toLatin('Љубав и џез, Ђорђе'), 'Ljubav i džez, Đorđe')
  assert.equal(toLatin('ЉУБАВ'), 'LJUBAV', 'капс остаётся капсом')
  assert.equal(toLatin('Њива'), 'Njiva')
})

test('латиница и прочие языки не трогаются', () => {
  assert.equal(toLatin('Slušajte naš novi singl'), 'Slušajte naš novi singl')
  assert.equal(toLatin('Listen to our new single'), 'Listen to our new single')
  assert.equal(toLatin('PADALI — POČETAK, 22.10.2026'), 'PADALI — POČETAK, 22.10.2026')
})

/** Сайт написан латиницей — кириллица в поле sr недопустима. */
test('кириллический ответ модели чинится на месте', async () => {
  const result = await translate(
    { text: 'Слушайте наш новый сингл', locales: LOCALES },
    {
      fetchImpl: reply(200, '{"en":"Listen to our new single","sr":"Слушајте наш нови сингл"}'),
      settings: SETTINGS
    }
  )

  assert.equal(result.translations.sr, 'Slušajte naš novi singl')
  assert.equal(result.translations.en, 'Listen to our new single', 'английский не трогаем')
})

test('в запросе прямо сказано про латиницу', async () => {
  const seen = {}
  await translate(
    { text: 'Фото', locales: LOCALES },
    { fetchImpl: reply(200, '{"en":"Photos","sr":"Fotografije"}', seen), settings: SETTINGS }
  )

  const system = seen.body.messages[0].content
  assert.match(system, /Latin script/)
  assert.match(system, /never in Cyrillic/)
})
