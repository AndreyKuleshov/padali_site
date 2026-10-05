import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import {
  createBlock, saveBlockTexts, saveBlockMedia, listBlocks, getBlockTexts, getBlock
} from '../src/repositories/blocks.js'
import { composePage } from '../src/services/page-composer.js'
import { createGallery } from '../src/repositories/galleries.js'
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

/* Снимок группы широкий, а экран телефона узкий: обрезка по
   ширине оставляла от четверых двоих. Своего кадра для телефона
   нет — вписываем широкий целиком и закрываем пустоту его же
   размытой копией; свой кадр есть — показываем только его, и
   размытая копия не грузится вовсе. */
test('на телефоне герой берёт свой кадр, а без него — размытие', async () => {
  const wide = (await processUpload({
    buffer: await makeImage({ width: 800, height: 500, seed: 73 }),
    originalName: 'wide.png', mime: 'image/png'
  })).media

  const hero = await createBlock({
    pageId, type: 'hero', settings: { ...defaultSettings('hero'), full_height: true }
  })
  await saveBlockMedia(hero, { background: [wide.id] })
  invalidateCache()

  let body = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(body, /class="hero-blur"/, 'без своего кадра — размытая подложка')
  assert.match(body, /aria-hidden="true"/, 'подложку не озвучивают')
  assert.doesNotMatch(body, /<source media=/, 'подменять нечем')

  const tall = (await processUpload({
    buffer: await makeImage({ width: 500, height: 800, seed: 74 }),
    originalName: 'tall.png', mime: 'image/png'
  })).media
  await saveBlockMedia(hero, { background: [wide.id], background_narrow: [tall.id] })
  invalidateCache()

  body = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(body, new RegExp(`<source media="\\(max-width: \\d+px\\)" srcset="[^"]*${tall.hash.slice(0, 16)}`),
    'свой кадр подставляется на узком экране')
  assert.match(body, /hero-media--art/, 'и обрезку выбирает группа, а не браузер')
  assert.doesNotMatch(body, /class="hero-blur"/, 'размытая копия больше не грузится')
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
  /* Вордмарк — заголовок первого уровня: на странице его не было
     вовсе, и поиск с читалкой не знали, чья это страница. */
  assert.match(response.body, /<h1 class="hero-wordmark">/)
  assert.doesNotMatch(response.body, /<h1 class="hero-wordmark hero-wordmark--built-in"/,
    'брендовый вордмарк в герое не рисуется')
  /* У заголовка должно быть имя: у загруженного файла подписи в
     медиатеке нет, и h1 остался бы пустым для читалки экрана. */
  assert.match(response.body, /<h1 class="hero-wordmark"><img[\s\S]*?alt="PADALI"/)
})

test('без своего логотипа берётся брендовый', async () => {
  await createBlock({
    pageId, type: 'hero', settings: { ...defaultSettings('hero'), show_wordmark: true }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body,
    /<h1 class="hero-wordmark hero-wordmark--built-in"><img src="\/brand\/padali-wordmark\.webp/)
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

/* ─── Якорь служебный ────────────────────────────────────── */

test('поля якоря в форме нет', async () => {
  const id = await createBlock({
    pageId, type: 'gallery', anchor: 'photos', settings: defaultSettings('gallery')
  })

  const response = await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: session.cookies
  })

  assert.doesNotMatch(response.body, /name="anchor"/)
  assert.match(response.body, /name="text\[en\]\[nav_label\]"/, 'пункт меню остался редактируемым')
})

/** Ссылки «/#photos» живут в меню и в переписке — ломать их нечем. */
test('якорь не меняется ни из формы, ни подделанным запросом', async () => {
  const id = await createBlock({
    pageId, type: 'gallery', anchor: 'photos', settings: defaultSettings('gallery')
  })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, anchor: 'podmena', 'settings[gallery_id]': '' })
  })

  assert.equal((await getBlock(id)).anchor, 'photos')
})

/** Блоки, заведённые до автоматической выдачи, остались без якоря. */
test('блоку без якоря он доназначается при сохранении', async () => {
  const id = await createBlock({
    pageId, type: 'gallery', anchor: null, settings: defaultSettings('gallery')
  })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, 'settings[gallery_id]': '' })
  })

  assert.equal((await getBlock(id)).anchor, 'photos')
})

test('у шапки и подвала якорь так и не появляется', async () => {
  const id = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })

  assert.equal((await getBlock(id)).anchor, null)
})

/* ─── Форма блока: заголовок в «Общем» ───────────────────── */

test('заголовок стоит выше пункта меню, а не среди текстов', async () => {
  const id = await createBlock({
    pageId, type: 'gallery', settings: defaultSettings('gallery')
  })

  const body = (await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: session.cookies
  })).body

  const heading = body.indexOf('name="text[en][heading]"')
  const navLabel = body.indexOf('name="text[en][nav_label]"')
  const textsCard = body.indexOf('>Texts<')
  const intro = body.indexOf('name="text[en][intro]"')

  assert.ok(heading > 0 && navLabel > 0 && textsCard > 0)
  assert.ok(heading < navLabel, 'заголовок — первое поле формы')
  assert.ok(heading < textsCard, 'и он выше раздела «Тексты»')
  assert.ok(intro > textsCard, 'остальные тексты остались на месте')
})

/** Включают блок последним действием — переключатель внизу. */
test('переключатель показа стоит после всех полей', async () => {
  const id = await createBlock({
    pageId, type: 'gallery', settings: defaultSettings('gallery')
  })

  const body = (await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: session.cookies
  })).body

  const toggle = body.indexOf('name="is_visible"')
  const lastField = body.lastIndexOf('name="settings[')
  const save = body.indexOf('form-actions')

  assert.ok(toggle > lastField, 'переключатель ниже настроек')
  assert.ok(toggle < save, 'но над кнопкой сохранения')
  assert.match(body, /class="switch"/)
})

test('у блока без заголовка «Общее» не ломается', async () => {
  const id = await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  const response = await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: session.cookies
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /name="text\[en\]\[nav_label\]"/)
  assert.match(response.body, /name="text\[en\]\[note\]"/, 'текст подвала остался в «Текстах»')
})

test('видимость по-прежнему сохраняется переключателем', async () => {
  // Галерею без альбома включить нельзя — это отдельная проверка,
  // и здесь она только мешала бы увидеть работу переключателя.
  const album = await createGallery('switch-test')
  const id = await createBlock({
    pageId,
    type: 'gallery',
    isVisible: false,
    settings: { ...defaultSettings('gallery'), gallery_id: album }
  })

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, is_visible: 'on', 'settings[gallery_id]': String(album) })
  })

  assert.equal((await getBlock(id)).isVisible, true)
})
