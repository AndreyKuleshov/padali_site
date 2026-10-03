import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, createTestServer, makeImage, closePool } from './helpers.js'
import { createPage, savePageTexts } from '../src/repositories/pages.js'
import { createBlock, saveBlockTexts, saveBlockMedia } from '../src/repositories/blocks.js'
import { createGallery, saveGalleryTexts, setGalleryItems } from '../src/repositories/galleries.js'
import { setSetting } from '../src/repositories/settings.js'
import { processUpload } from '../src/services/media-processor.js'
import { defaultSettings } from '../src/blocks/index.js'
import { invalidateCache } from '../src/services/cache.js'

let app

beforeEach(async () => {
  await resetDatabase()
  if (!app) app = await createTestServer()
  invalidateCache()
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

/** Страница из трёх блоков: шапка, галерея и текст. */
async function buildPage () {
  const pageId = await createPage({ slug: 'home' })
  await savePageTexts(pageId, {
    en: { title: 'PADALI', description: 'Rapcore band' },
    sr: { title: 'PADALI', description: 'Repkor bend' }
  })

  const { media } = await processUpload({
    buffer: await makeImage({ width: 1400, height: 900, seed: 11 }),
    originalName: 'hero.png',
    mime: 'image/png'
  })

  const hero = await createBlock({
    pageId, type: 'hero', settings: { ...defaultSettings('hero'), full_height: true }
  })
  await saveBlockTexts(hero, {
    en: { tagline: 'Loud, honest, right now.' },
    sr: { tagline: 'Glasno, iskreno, upravo sada.' }
  })
  await saveBlockMedia(hero, { background: [media.id] })

  const album = await createGallery('photos')
  await saveGalleryTexts(album, { en: { title: 'Photos' }, sr: { title: 'Fotografije' } })
  await setGalleryItems(album, [media.id])

  const gallery = await createBlock({
    pageId, type: 'gallery', anchor: 'photos',
    settings: { ...defaultSettings('gallery'), gallery_id: album }
  })
  await saveBlockTexts(gallery, {
    en: { heading: 'Photos', nav_label: 'Photos' },
    sr: { heading: 'Fotografije', nav_label: 'Fotografije' }
  })

  await setSetting('social', [{ icon: 'instagram', label: 'Instagram', url: 'https://instagram.com/padali.band' }])
  return { pageId, mediaId: media.id }
}

test('главная отдаёт обе языковые версии по своим адресам', async () => {
  await buildPage()

  const en = await app.inject({ method: 'GET', url: '/' })
  assert.equal(en.statusCode, 200)
  assert.match(en.body, /<html lang="en">/)
  assert.match(en.body, /Loud, honest, right now\./)
  assert.doesNotMatch(en.body, /Glasno, iskreno/, 'сербский текст в английскую версию не попадает')

  const sr = await app.inject({ method: 'GET', url: '/sr' })
  assert.equal(sr.statusCode, 200)
  assert.match(sr.body, /<html lang="sr">/)
  assert.match(sr.body, /Glasno, iskreno, upravo sada\./)
})

test('в head есть canonical и hreflang на обе версии', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, /<link rel="canonical" href="[^"]+\/">/)
  assert.match(response.body, /hreflang="en"/)
  assert.match(response.body, /hreflang="sr"/)
  assert.match(response.body, /hreflang="x-default"/)
})

test('адрес языка по умолчанию схлопывается в корень', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/en' })
  assert.equal(response.statusCode, 301)
  assert.equal(response.headers.location, '/')
})

test('неизвестный язык и несуществующий путь дают 404', async () => {
  await buildPage()
  for (const url of ['/de', '/какая-то-страница']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 404, url)
  }
})

test('ETag позволяет браузеру не скачивать страницу повторно', async () => {
  await buildPage()

  const first = await app.inject({ method: 'GET', url: '/' })
  const etag = first.headers.etag
  assert.ok(etag, 'ETag выставлен')

  const second = await app.inject({ method: 'GET', url: '/', headers: { 'if-none-match': etag } })
  assert.equal(second.statusCode, 304)
  assert.equal(second.body, '')
})

test('галерея попадает в разметку со срезами по ширине', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, /<section class="section wrap" id="photos">/)
  assert.match(response.body, /class="gallery gallery--grid"/)
  assert.match(response.body, /srcset="[^"]*-320\.webp 320w/)
  assert.match(response.body, /sizes="/)
})

test('меню собирается из якорей блоков', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /<a href="#photos">Photos<\/a>/)
})

test('пустой сайт без страницы отдаёт 404, а не падает', async () => {
  const response = await app.inject({ method: 'GET', url: '/' })
  assert.equal(response.statusCode, 404)
})

test('служебные адреса работают', async () => {
  await buildPage()

  const health = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json(), { status: 'ok' })

  const robots = await app.inject({ method: 'GET', url: '/robots.txt' })
  assert.match(robots.body, /Disallow: \/admin/)

  const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' })
  assert.match(sitemap.body, /<loc>[^<]+\/<\/loc>/)
  assert.match(sitemap.body, /<loc>[^<]+\/sr<\/loc>/)
})

test('строковая настройка доходит до страницы без потерь', async () => {
  await buildPage()
  await setSetting('footer_note', 'padali.band · 2026')
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /padali\.band · 2026/, 'подвал берёт значение из настроек')
})

test('текст из базы экранируется при выводе', async () => {
  const { pageId } = await buildPage()
  const block = await createBlock({ pageId, type: 'richtext', settings: defaultSettings('richtext') })
  await saveBlockTexts(block, {
    en: { heading: '<script>alert(1)</script>', body: '<p>ок</p><script>alert(2)</script>' }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.doesNotMatch(response.body, /<script>alert\(1\)/, 'заголовок экранирован')
  assert.doesNotMatch(response.body, /<script>alert\(2\)/, 'richtext очищен от скриптов')
  assert.match(response.body, /<p>ок<\/p>/, 'разрешённая разметка сохранена')
})
