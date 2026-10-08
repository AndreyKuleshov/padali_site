/**
 * Блок с роликом YouTube.
 *
 * Ссылку приносят в полудюжине видов, а ошибиться в ней легко,
 * поэтому разбор и проверка наличия ролика живут в коде, а не в
 * надежде на внимательность редактора.
 */
import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, getBlock, saveBlockTexts } from '../src/repositories/blocks.js'
import { defaultSettings, getBlockType } from '../src/blocks/index.js'
import { parseVideoId, lookupVideo, embedUrl } from '../src/services/youtube.js'
import { linkify } from '../src/services/renderer.js'

const ID = 'dQw4w9WgXcQ'

let app
let auth

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  app = await createTestServer()
  auth = await loginAs(app)
})

after(async () => { await closePool() })

/** Ответ oEmbed без похода в сеть. */
function stubFetch (status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

test('идентификатор достаётся из любой формы ссылки', () => {
  const forms = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=10`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    ID
  ]
  for (const input of forms) {
    assert.equal(parseVideoId(input), ID, `не разобрано: ${input}`)
  }
})

test('чужая ссылка и мусор отвергаются', () => {
  for (const input of ['', '   ', 'https://vimeo.com/12345', 'https://example.com/watch?v=' + ID,
    'не ссылка', 'https://www.youtube.com/watch?v=короткий', 'https://www.youtube.com/']) {
    assert.equal(parseVideoId(input), null, `зря разобрано: ${input}`)
  }
})

test('существующий ролик приносит название и обложку', async () => {
  const result = await lookupVideo(`https://youtu.be/${ID}`, {
    fetchImpl: stubFetch(200, { title: 'PADALI — POČETAK', author_name: 'PADALI', thumbnail_url: 'https://i.ytimg.com/x.jpg' })
  })

  assert.deepEqual(result, {
    ok: true, id: ID, title: 'PADALI — POČETAK', author: 'PADALI', thumbnail: 'https://i.ytimg.com/x.jpg'
  })
})

/* На несуществующий ролик oEmbed отвечает 400, а не 404 —
   проверено на живом сервисе. Приняли бы только 404 — редактор
   вместо «видео не найдено» читал бы «нет связи». */
test('удалённый ролик — «не найдено», какой бы код ни пришёл', async () => {
  for (const status of [400, 404]) {
    const result = await lookupVideo(`https://youtu.be/${ID}`, { fetchImpl: stubFetch(status, {}) })
    assert.deepEqual(result, { ok: false, reason: 'not_found' }, `код ${status}`)
  }
})

/** Приватный ролик существует — путать его с опечаткой нельзя. */
test('закрытый для встраивания отличается от ненайденного', async () => {
  const result = await lookupVideo(`https://youtu.be/${ID}`, { fetchImpl: stubFetch(401, {}) })
  assert.deepEqual(result, { ok: false, reason: 'blocked' })
})

test('недоступная сеть не выдаётся за отсутствие ролика', async () => {
  const result = await lookupVideo(`https://youtu.be/${ID}`, {
    fetchImpl: async () => { throw new Error('ECONNREFUSED') }
  })
  assert.deepEqual(result, { ok: false, reason: 'unreachable' })
})

test('нераспознанная ссылка до сети не доходит', async () => {
  let called = false
  const result = await lookupVideo('https://vimeo.com/1', {
    fetchImpl: async () => { called = true; return stubFetch(200, {})() }
  })
  assert.deepEqual(result, { ok: false, reason: 'invalid' })
  assert.equal(called, false, 'сеть не трогаем, пока ссылка заведомо чужая')
})

test('блок есть в конструкторе', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin', cookies: auth.cookies })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /value="youtube"/)
  assert.match(response.body, /YouTube video/)
})

test('форма блока показывает поле ссылки с превью', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({ pageId, type: 'youtube', settings: defaultSettings('youtube') })

  const response = await app.inject({ method: 'GET', url: `/admin/blocks/${id}`, cookies: auth.cookies })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /data-youtube-field/)
  assert.match(response.body, /data-youtube-preview/)
})

/** Хранить разнобой нельзя: шаблон разбирал бы его каждый раз заново. */
test('при сохранении ссылка приводится к одному виду', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({ pageId, type: 'youtube', settings: defaultSettings('youtube') })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: auth.cookies,
    ...form({ _csrf: auth.csrf, 'settings[url]': `https://youtu.be/${ID}?t=30` })
  })

  const block = await getBlock(id)
  assert.equal(block.settings.url, `https://www.youtube.com/watch?v=${ID}`)
})

test('мусор вместо ссылки не сохраняется и блок не включить', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({
    pageId, type: 'youtube', isVisible: false, settings: defaultSettings('youtube')
  })

  const response = await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: auth.cookies,
    ...form({ _csrf: auth.csrf, 'settings[url]': 'https://vimeo.com/12345', is_visible: 'on' })
  })

  assert.equal(response.statusCode, 302)
  const block = await getBlock(id)
  assert.equal(block.settings.url ?? '', '', 'чужая ссылка не записана')
  assert.equal(block.isVisible, false, 'блок без ролика не включается')
})

test('на сайте рисуется обложка, а не плеер', async () => {
  const pageId = await createPage({ slug: 'home' })
  await createBlock({
    pageId,
    type: 'youtube',
    isVisible: true,
    settings: { ...defaultSettings('youtube'), url: `https://www.youtube.com/watch?v=${ID}` }
  })

  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, new RegExp(`data-video="${ID}"`))
  assert.match(response.body, /i\.ytimg\.com/, 'обложка на месте')
  assert.doesNotMatch(response.body, /<iframe/, 'плеер подгружается только по клику')
  // В атрибуте «&» приходит экранированным — браузер вернёт его
  // обратно, поэтому сравниваем с тем, что реально в разметке.
  assert.ok(response.body.includes(embedUrl(ID, { autoplay: true }).replace(/&/g, '&amp;')),
    'адрес плеера подготовлен в разметке')
})

test('блок без ссылки не роняет страницу', async () => {
  const pageId = await createPage({ slug: 'home' })
  await createBlock({
    pageId, type: 'youtube', isVisible: true, settings: defaultSettings('youtube')
  })

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /data-video=/)
})

test('заголовок переводится', async () => {
  assert.equal(getBlockType('youtube').texts[0].key, 'title')
  const descriptor = getBlockType('youtube')
  assert.ok(descriptor.title.en && descriptor.title.sr)
  assert.ok(descriptor.settings.find((field) => field.key === 'url').required)
})

/* Подпись под роликом — простая textarea, и адрес в ней редактор
   пишет текстом. Разметку собирает linkify, поэтому экранирование
   с него и спрашиваем: он печатается через <%~, шаблон уже не
   поможет. */
test('адрес в подписи становится ссылкой, остальное экранируется', () => {
  assert.equal(
    linkify('Subscribe! https://www.youtube.com/@PADALIband'),
    'Subscribe! <a href="https://www.youtube.com/@PADALIband" target="_blank" ' +
    'rel="noopener">https://www.youtube.com/@PADALIband</a>'
  )

  /* Кавычка не должна выводить чужой текст из атрибута. */
  const quoted = linkify('тут https://example.com/a" onmouseover=beda')
  assert.match(quoted, /href="https:\/\/example\.com\/a"/, 'адрес кончается на кавычке')
  assert.match(quoted, /<\/a>&quot; onmouseover=beda$/, 'хвост остался текстом за пределами ссылки')

  /* Разметка в тексте остаётся текстом — и до ссылки, и после:
     это два разных куска внутри linkify, экранировать надо оба. */
  assert.equal(linkify('<b>жир</b>'), '&lt;b&gt;жир&lt;/b&gt;')
  assert.match(linkify('<b>тут</b> https://example.com/ <i>там</i>'),
    /^&lt;b&gt;тут&lt;\/b&gt; <a [^>]*>.*<\/a> &lt;i&gt;там&lt;\/i&gt;$/)

  /* Ссылкой становится только то, что ей объявлено: javascript:
     мимо такого разбора не проходит. */
  assert.equal(linkify('javascript:alert(1)'), 'javascript:alert(1)')

  /* Точка в конце предложения — не часть адреса. */
  assert.match(linkify('см. https://example.com/page.'), />https:\/\/example\.com\/page<\/a>\.$/)

  /* «&» в запросе уезжает в разметку как &amp; — браузер вернёт
     его обратно, адрес от этого не меняется. */
  assert.match(linkify('https://example.com/?a=1&b=2'), /href="https:\/\/example\.com\/\?a=1&amp;b=2"/)
})

test('подпись под роликом на сайте — со ссылкой', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({
    pageId,
    type: 'youtube',
    isVisible: true,
    settings: { ...defaultSettings('youtube'), url: `https://www.youtube.com/watch?v=${ID}` }
  })
  await saveBlockTexts(id, { en: { note: 'Subscribe! https://www.youtube.com/@PADALIband' } })

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const note = /<p class="video-note">[\s\S]*?<\/p>/.exec(body)[0]

  assert.match(note, /<a href="https:\/\/www\.youtube\.com\/@PADALIband"/)
  assert.match(note, /rel="noopener"/, 'чужая вкладка не получает доступ к нашей')
})
