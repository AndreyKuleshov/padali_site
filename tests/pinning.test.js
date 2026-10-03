import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockTexts, saveBlockMedia, listBlocks } from '../src/repositories/blocks.js'
import { composePage } from '../src/services/page-composer.js'
import { processUpload } from '../src/services/media-processor.js'
import { defaultSettings, sortBlocks, pinOf, listBlockTypes } from '../src/blocks/index.js'
import { invalidateCache } from '../src/services/cache.js'

let app
let session
let pageId

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  pageId = await createPage({ slug: 'home' })
  if (!app) app = await createTestServer()
  session = await loginAs(app)
  invalidateCache()
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

test('шапка закреплена сверху, подвал снизу', () => {
  assert.equal(pinOf('hero'), 'top')
  assert.equal(pinOf('footer'), 'bottom')
  assert.equal(pinOf('gallery'), null)
})

/** Порядок на сайте не должен зависеть от того, когда блоки создали. */
test('закреплённые блоки встают по краям, что бы ни стояло в позиции', async () => {
  await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })
  await createBlock({ pageId, type: 'links', settings: defaultSettings('links') })
  await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  await createBlock({ pageId, type: 'richtext', settings: defaultSettings('richtext') })

  const page = await composePage({ slug: 'home', locale: 'en' })
  assert.deepEqual(page.blocks.map((block) => block.type), ['hero', 'links', 'richtext', 'footer'])
})

test('перестановка обычных блоков не трогает края', async () => {
  const hero = await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  const links = await createBlock({ pageId, type: 'links', settings: defaultSettings('links') })
  const text = await createBlock({ pageId, type: 'richtext', settings: defaultSettings('richtext') })
  const footer = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  // Пытаемся поставить подвал первым, а шапку последней.
  await app.inject({
    method: 'POST',
    url: '/admin/blocks/reorder',
    cookies: session.cookies,
    payload: { _csrf: session.csrf, order: [footer, text, links, hero] }
  })
  invalidateCache()

  const page = await composePage({ slug: 'home', locale: 'en' })
  assert.equal(page.blocks[0].type, 'hero', 'шапка осталась первой')
  assert.equal(page.blocks.at(-1).type, 'footer', 'подвал остался последним')
  assert.deepEqual(page.blocks.map((b) => b.type), ['hero', 'richtext', 'links', 'footer'],
    'между краями порядок редактора соблюдён')
})

test('сортировка устойчива при равных позициях', () => {
  const sorted = sortBlocks([
    { id: 7, type: 'links', position: 0 },
    { id: 3, type: 'gallery', position: 0 },
    { id: 9, type: 'hero', position: 0 }
  ])
  assert.deepEqual(sorted.map((b) => b.id), [9, 3, 7])
})

test('в списке типов видно, что блок закреплён', () => {
  const types = listBlockTypes()
  assert.equal(types.find((t) => t.type === 'hero').pinned, 'top')
  assert.equal(types.find((t) => t.type === 'footer').pinned, 'bottom')
  assert.equal(types.find((t) => t.type === 'concert').pinned, null)
})

test('в админке у закреплённых блоков нет ручки перетаскивания', async () => {
  await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  await createBlock({ pageId, type: 'links', settings: defaultSettings('links') })

  const response = await app.inject({ method: 'GET', url: '/admin', cookies: session.cookies })
  assert.match(response.body, /block-row--pinned/)
  assert.match(response.body, /drag-handle--locked/)
  assert.equal((response.body.match(/class="drag-handle"/g) || []).length, 1,
    'ручка только у незакреплённого блока')
})

test('свой логотип в шапке заменяет брендовый', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 600, height: 120, seed: 71 }),
    originalName: 'logo.png', mime: 'image/png'
  })
  const hero = await createBlock({
    pageId, type: 'hero', settings: { ...defaultSettings('hero'), show_wordmark: true }
  })
  await saveBlockMedia(hero, { logo: [media.id] })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /hero-wordmark--own/)
  assert.doesNotMatch(response.body, /class="hero-wordmark" src="\/brand/)
})

test('без своего логотипа берётся брендовый', async () => {
  await createBlock({
    pageId, type: 'hero', settings: { ...defaultSettings('hero'), show_wordmark: true }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /class="hero-wordmark" src="\/brand\/padali-wordmark\.webp/)
})

test('блок-подвал заменяет статический', async () => {
  const footer = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })
  await saveBlockTexts(footer, { en: { note: 'padali.band · 2026' } })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.equal((response.body.match(/class="wrap site-footer"/g) || []).length, 1,
    'подвал на странице один')
  assert.match(response.body, /padali\.band · 2026/)
})

test('без блока-подвала показывается прежний статический', async () => {
  await createBlock({ pageId, type: 'links', settings: defaultSettings('links') })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /site-footer/)
})

test('ссылки в подвале выводятся иконками', async () => {
  const footer = await createBlock({
    pageId,
    type: 'footer',
    settings: {
      ...defaultSettings('footer'),
      links: [{ icon: 'instagram', label: 'Instagram', url: 'https://instagram.com/padali.band' }]
    }
  })
  await saveBlockTexts(footer, { en: { note: 'padali.band' } })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /site-footer-links/)
  assert.match(response.body, /instagram\.com\/padali\.band/)
})
