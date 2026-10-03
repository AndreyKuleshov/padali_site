import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import {
  createBlock, saveBlockTexts, saveBlockMedia, listBlocks, getBlockTexts
} from '../src/repositories/blocks.js'
import { composePage } from '../src/services/page-composer.js'
import { processUpload } from '../src/services/media-processor.js'
import {
  defaultSettings, sortBlocks, pinOf, listBlockTypes, nextAnchor, getBlockType
} from '../src/blocks/index.js'
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

/* ─── Закреплённые блоки: один и навсегда ────────────────── */

test('шапка и подвал не предлагаются, когда уже стоят на странице', async () => {
  await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  const response = await app.inject({ method: 'GET', url: '/admin', cookies: session.cookies })
  const options = [...response.body.matchAll(/<option value="([a-z_]+)"/g)].map((match) => match[1])

  assert.ok(!options.includes('hero'), 'второй шапки быть не может')
  assert.ok(!options.includes('footer'), 'второго подвала быть не может')
  assert.ok(options.includes('gallery'), 'обычные типы остаются')
  assert.ok(options.includes('youtube'))
})

/** Старая установка могла остаться без подвала — его надо чем-то завести. */
test('отсутствующий закреплённый тип остаётся в списке', () => {
  const offered = listBlockTypes(['hero']).map((item) => item.type)

  assert.ok(!offered.includes('hero'))
  assert.ok(offered.includes('footer'), 'подвала на странице нет — предлагаем добавить')
})

test('без аргумента список полный', () => {
  const offered = listBlockTypes().map((item) => item.type)
  assert.ok(offered.includes('hero'))
  assert.ok(offered.includes('footer'))
})

test('второй закреплённый блок не создаётся и в обход выпадайки', async () => {
  await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  await app.inject({
    method: 'POST',
    url: '/admin/blocks',
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'footer' })
  })

  const footers = (await listBlocks(pageId)).filter((block) => block.type === 'footer')
  assert.equal(footers.length, 1)
})

test('у шапки и подвала нет кнопки удаления', async () => {
  const hero = await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  const footer = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })
  const gallery = await createBlock({ pageId, type: 'gallery', settings: defaultSettings('gallery') })

  const response = await app.inject({ method: 'GET', url: '/admin', cookies: session.cookies })

  assert.doesNotMatch(response.body, new RegExp(`/admin/blocks/${hero}/delete`))
  assert.doesNotMatch(response.body, new RegExp(`/admin/blocks/${footer}/delete`))
  assert.match(response.body, new RegExp(`/admin/blocks/${gallery}/delete`), 'обычный блок удаляется')
})

test('запрос на удаление закреплённого блока отклоняется', async () => {
  const footer = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  const response = await app.inject({
    method: 'POST',
    url: `/admin/blocks/${footer}/delete`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })

  assert.equal(response.statusCode, 302)
  const blocks = await listBlocks(pageId)
  assert.ok(blocks.some((block) => block.id === footer), 'подвал на месте')
})

test('незакреплённый блок удаляется как прежде', async () => {
  const gallery = await createBlock({ pageId, type: 'gallery', settings: defaultSettings('gallery') })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${gallery}/delete`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })

  const blocks = await listBlocks(pageId)
  assert.ok(!blocks.some((block) => block.id === gallery))
})

/* ─── Заполнение нового блока ────────────────────────────── */

test('новый блок приходит с якорем и пунктом меню на всех языках', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/blocks',
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'youtube' })
  })

  const id = Number(/\/admin\/blocks\/(\d+)/.exec(response.headers.location)[1])
  const blocks = await listBlocks(pageId)
  const created = blocks.find((block) => block.id === id)

  assert.equal(created.anchor, 'video')

  const texts = await getBlockTexts(id)
  assert.equal(texts.en.nav_label, 'Clips')
  assert.equal(texts.sr.nav_label, 'Spotovi')
})

/** Два одинаковых якоря сделали бы второй блок недостижимым. */
test('второй блок того же типа получает свободный якорь', async () => {
  for (let i = 0; i < 2; i += 1) {
    await app.inject({
      method: 'POST',
      url: '/admin/blocks',
      cookies: session.cookies,
      ...form({ _csrf: session.csrf, type: 'gallery' })
    })
  }

  const anchors = (await listBlocks(pageId))
    .filter((block) => block.type === 'gallery')
    .map((block) => block.anchor)

  assert.deepEqual(anchors.sort(), ['photos', 'photos-2'])
})

test('свободный якорь ищется по занятым', () => {
  assert.equal(nextAnchor('video', []), 'video')
  assert.equal(nextAnchor('video', ['photos']), 'video')
  assert.equal(nextAnchor('video', ['video']), 'video-2')
  assert.equal(nextAnchor('video', ['video', 'video-2']), 'video-3')
  assert.equal(nextAnchor(null, []), null, 'шапке и подвалу якорь не нужен')
})

test('у закреплённых блоков якоря и пункта меню нет', () => {
  for (const type of ['hero', 'footer']) {
    assert.equal(getBlockType(type).defaults, undefined, `${type} в меню не выводится`)
  }
})
