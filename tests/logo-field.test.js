/**
 * Логотип в админке.
 *
 * Шапка, hero и подвал рисуют логотип по цепочке «свой → из
 * настроек → встроенный». Поле в админке обязано показывать ту же
 * картинку: пустое поле при видимом на сайте логотипе читается как
 * поломка, с этого и начался баг.
 */
import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, makeImage, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockMedia } from '../src/repositories/blocks.js'
import { setSetting } from '../src/repositories/settings.js'
import { defaultSettings } from '../src/blocks/index.js'
import { processUpload } from '../src/services/media-processor.js'
import { BUILT_IN_LOGO, currentSiteLogo } from '../src/services/site-logo.js'

let app
let auth

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  app = await createTestServer()
  auth = await loginAs(app)
})

after(async () => { await closePool() })

async function footerBlock () {
  const pageId = await createPage({ slug: 'home' })
  return createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })
}

function get (url) {
  return app.inject({ method: 'GET', url, cookies: auth.cookies })
}

/** Multipart-тело: inject принимает готовый буфер и заголовок. */
async function multipart (fields, file) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  if (file) data.append('files', new Blob([file.buffer], { type: file.mime }), file.name)

  const request = new Request('http://test', { method: 'POST', body: data })
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { 'content-type': request.headers.get('content-type') }
  }
}

test('без своего логотипа поле показывает встроенный', async () => {
  const id = await footerBlock()
  const response = await get(`/admin/blocks/${id}`)

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /media-inherited/, 'показана действующая картинка')
  assert.match(response.body, /brand\/padali-wordmark\.webp/)
  assert.match(response.body, /Now showing the built-in logo/)
})

test('логотип из настроек виден в поле блока', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 120, seed: 11 }),
    originalName: 'logo.png',
    mime: 'image/png'
  })
  await setSetting('logo_id', media.id)

  const id = await footerBlock()
  const response = await get(`/admin/blocks/${id}`)

  assert.match(response.body, /Now showing the logo from site settings/)
  assert.doesNotMatch(response.body, /brand\/padali-wordmark\.webp/,
    'встроенный логотип уже не действует')
})

test('у поля со своей картинкой подсказки о чужой нет', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 120, seed: 12 }),
    originalName: 'own.png',
    mime: 'image/png'
  })
  const id = await footerBlock()
  await saveBlockMedia(id, { logo: [media.id] })

  const response = await get(`/admin/blocks/${id}`)
  assert.doesNotMatch(response.body, /media-inherited/)
})

/** Раньше превью брало thumb у сырой строки медиатеки, где его нет. */
test('в настройках превью показывает выбранный логотип, а не пустоту', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 120, seed: 13 }),
    originalName: 'header.png',
    mime: 'image/png'
  })
  await setSetting('logo_id', media.id)

  const response = await get('/admin/settings')
  assert.equal(response.statusCode, 200)

  const preview = /<img src="([^"]*)" alt="" id="logoPreview">/.exec(response.body)
  assert.ok(preview, 'превью логотипа отрисовано')
  assert.match(preview[1], /^\/uploads\//, 'адрес ведёт на загруженный файл')
  assert.match(response.body, /header\.png/, 'подписано именем файла')
})

test('в настройках без своего логотипа показан встроенный', async () => {
  const response = await get('/admin/settings')
  assert.match(response.body, /brand\/padali-wordmark\.webp/)
  assert.match(response.body, /Built-in logo/)
})

test('удалённый из медиатеки логотип откатывается на встроенный', async () => {
  await setSetting('logo_id', 987654)
  const logo = await currentSiteLogo()

  assert.equal(logo.builtIn, true)
  assert.ok(logo.thumb.startsWith(BUILT_IN_LOGO), 'путь встроенного файла с отпечатком')
})

test('загрузка из формы возвращает готовую картинку в JSON', async () => {
  const body = await multipart({ _csrf: auth.csrf }, {
    buffer: await makeImage({ width: 500, height: 160, seed: 14 }),
    mime: 'image/png',
    name: 'uploaded-logo.png'
  })

  const response = await app.inject({
    method: 'POST',
    url: '/admin/media/upload.json',
    cookies: auth.cookies,
    ...body
  })

  assert.equal(response.statusCode, 200)
  const result = response.json()
  assert.equal(result.errors.length, 0)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].name, 'uploaded-logo.png')
  assert.ok(Number.isInteger(result.items[0].id))
  assert.match(result.items[0].thumb, /^\/uploads\//)
})

test('загрузка без токена отклоняется', async () => {
  const body = await multipart({}, {
    buffer: await makeImage({ width: 300, height: 100, seed: 15 }),
    mime: 'image/png',
    name: 'no-token.png'
  })

  const response = await app.inject({
    method: 'POST',
    url: '/admin/media/upload.json',
    cookies: auth.cookies,
    ...body
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().items.length, 0)
})
