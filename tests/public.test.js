import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage,
  closePool, soon, asShown
} from './helpers.js'
import { createPage, savePageTexts } from '../src/repositories/pages.js'
import { createBlock, updateBlock, saveBlockTexts, saveBlockMedia } from '../src/repositories/blocks.js'
import { createGallery, saveGalleryTexts, setGalleryItems } from '../src/repositories/galleries.js'
import { setSetting } from '../src/repositories/settings.js'
import { processUpload } from '../src/services/media-processor.js'
import { saveMediaTexts } from '../src/repositories/media.js'
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

  /* Обвязка — подписи стрелок, кнопок, ответов форм — приходит не
     из блоков, а из словаря сайта, и язык у неё тот же. */
  assert.match(sr.body, /Društvene mreže/, 'aria-подпись переведена')
  assert.doesNotMatch(sr.body, /Social links/)
  assert.match(en.body, /Social links/)
})

/* Страницы нарезаны на сервере по числу колонок для монитора. На
   телефоне колонок меньше, остаток давал дыру в сетке, и стрелки
   звали листать внутрь неё. Телефону отдаём своё число колонок,
   а страницы там распускаются в одну сетку средствами CSS. */
test('у галереи своё число колонок для телефона', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, /--gallery-columns-mobile: \d+/)
  assert.match(
    response.body,
    /sizes="\(max-width: 640px\) calc\(\(100vw - \d+px\) \/ 2\)/,
    'в sizes то же число колонок, что покажет телефон'
  )
})

/* На телефоне разделы открываются кнопкой в шапке: полоса из
   семи пунктов занимала пол-экрана ещё до содержимого. Список
   один на обе оболочки — разойтись им нечем. */
test('меню разделов есть и полосой, и кнопкой с панелью', async () => {
  await buildPage()
  const body = (await app.inject({ method: 'GET', url: '/' })).body

  assert.match(body, /class="menu-toggle"[^>]*aria-controls="sideMenu"/)
  assert.match(body, /aria-expanded="false"/, 'закрытое меню объявлено закрытым')
  assert.match(body, /id="sideMenu"[^>]*hidden/, 'панель скрыта до нажатия')
  assert.match(body, /class="side-menu-close"/, 'в панели есть кнопка закрыть')

  const strip = body.slice(body.indexOf('class="quicknav'))
  const panel = body.slice(body.indexOf('side-menu-links'))
  const links = (html) => [...html.matchAll(/<a href="#([a-z0-9-]+)"/g)].map((m) => m[1])

  assert.ok(links(strip).length > 0, 'в полосе есть разделы')
  assert.deepEqual(
    links(panel).slice(0, links(strip).length),
    links(strip),
    'в панели те же разделы и в том же порядке'
  )
})

/* Панель лежит рядом с шапкой, а не внутри: у .topbar есть
   backdrop-filter, и он становится точкой отсчёта для fixed —
   панель внутри обрезалась бы по высоте шапки. */
test('панель меню стоит вне шапки', async () => {
  await buildPage()
  const body = (await app.inject({ method: 'GET', url: '/' })).body

  const header = body.slice(body.indexOf('<header'), body.indexOf('</header>'))
  assert.doesNotMatch(header, /id="sideMenu"/)
  assert.match(body, /<\/header>[\s\S]{0,200}id="sideMenu"/)
})

/* Поле связи и кнопка отправки — одна строка, поэтому кнопка
   живёт внутри партиала. В окне заказа мерча тот же партиал, но
   кнопка там своя, под всеми полями: иначе «Отправить» встало бы
   посреди формы, выше города и сообщения. */
test('кнопка отправки стоит в строке связи, а в окне заказа — нет', async () => {
  const { pageId, mediaId } = await buildPage()

  await createBlock({
    pageId, type: 'contact', anchor: 'contact',
    settings: { ...defaultSettings('contact'), email: 'padaliband@gmail.com', show_form: true }
  })
  const shop = await createGallery('shop')
  await setGalleryItems(shop, [{ mediaId, price: '2500 RSD' }])
  await createBlock({
    pageId, type: 'merch', anchor: 'merch',
    settings: { ...defaultSettings('merch'), gallery_id: shop }
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body

  // Строка связи от её начала до сообщения об ошибке под ней.
  const rowOf = (kind) => {
    const form = body.slice(body.indexOf(`data-kind="${kind}"`))
    return form.slice(form.indexOf('<div class="contact-row'), form.indexOf('data-contact-error'))
  }

  const row = rowOf('contact')
  assert.match(row, /class="contact-row contact-row--send"/)
  assert.match(row, /<button type="submit"[^>]*class="button contact-send"/)

  const order = rowOf('order')
  assert.doesNotMatch(order, /contact-row--send/)
  assert.doesNotMatch(order, /type="submit"/, 'в окне заказа кнопка ниже, а не в строке')
})

/* Два способа попасть на концерт: купить по ссылке или взять на
   входе. Ссылка остаётся в настройках от прошлого концерта, и при
   «на входе» её показывать нельзя — поведут не туда. */
test('билеты: по ссылке — кнопка, на входе — строка без ссылки', async () => {
  const { pageId } = await buildPage()

  await createBlock({
    pageId, type: 'concert', anchor: 'shows',
    settings: {
      ...defaultSettings('concert'),
      events: [
        { date: soon(7), tickets: 'link', ticket_url: 'https://tickets.example/padali', price: '800 RSD' },
        { date: soon(40), tickets: 'door', ticket_url: 'https://tickets.example/старый', price: '600 RSD' }
      ]
    }
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const section = /<section class="section wrap" id="shows">[\s\S]*?<\/section>/.exec(body)[0]
  const cards = section.split('class="concert-grid')

  assert.match(cards[1], /href="https:\/\/tickets\.example\/padali"/)
  assert.match(cards[1], /800 RSD/)

  assert.doesNotMatch(cards[2], /tickets\.example/, 'ссылка этого концерта не показывается')
  assert.match(cards[2], /concert-door/)
  assert.match(cards[2], /Tickets at the door/)
  assert.match(cards[2], /600 RSD/)
})

/* Переключатель языка показывал одну кнопку — тот язык, на который
   переключишься. Её принимали за указание текущего и ошибались.
   Теперь видно оба, текущий помечен и не ссылка. */
test('в переключателе видно оба языка, текущий помечен', async () => {
  await buildPage()

  for (const [url, current, other] of [['/', 'EN', 'SR'], ['/sr', 'SR', 'EN']]) {
    const body = (await app.inject({ method: 'GET', url })).body
    const nav = /<nav class="lang-switch"[\s\S]*?<\/nav>/.exec(body)[0]

    assert.match(nav, new RegExp(`<span class="lang-btn" aria-current="true">${current}</span>`),
      `на ${url} текущий язык помечен и не ссылка`)
    assert.match(nav, new RegExp(`<a class="lang-btn"[^>]*>${other}</a>`),
      'второй язык остаётся ссылкой')
  }
})

/* Подпись доезжает до просмотрщика, даже когда под миниатюрами её
   не показывают: в ленте она мешает, а в просмотрщике место есть и
   человек смотрит один снимок. Раньше просмотрщик брал её только из
   <figcaption> на странице — при выключенных подписях её не было
   нигде, хотя у снимка она есть. */
test('подпись едет в просмотрщик даже при выключенных подписях в ленте', async () => {
  const { pageId } = await buildPage()

  const { media } = await processUpload({
    buffer: await makeImage({ width: 400, height: 300, seed: 61 }),
    originalName: 'shot.png', mime: 'image/png'
  })
  await saveMediaTexts(media.id, { en: { caption: 'Подпись к снимку' } })

  const album = await createGallery('shots')
  await setGalleryItems(album, [media.id])

  await createBlock({
    pageId, type: 'gallery', anchor: 'shots',
    settings: { ...defaultSettings('gallery'), gallery_id: album, show_captions: false }
  })
  await createBlock({
    pageId, type: 'gallery', anchor: 'shots-captioned',
    settings: { ...defaultSettings('gallery'), gallery_id: album, show_captions: true }
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const cut = (id) => new RegExp(`<section class="section wrap" id="${id}">[\\s\\S]*?<\\/section>`).exec(body)[0]

  const quiet = cut('shots')
  assert.doesNotMatch(quiet, /<figcaption/, 'под миниатюрой подписи нет — так и просили')
  assert.match(quiet, /data-caption="Подпись к снимку"/, 'а просмотрщику она передана')

  /* С включёнными подписями видно и то, и другое: одно другому не
     мешает, и просмотрщик по-прежнему берёт свою. */
  const loud = cut('shots-captioned')
  assert.match(loud, /<figcaption>Подпись к снимку<\/figcaption>/)
  assert.match(loud, /data-caption="Подпись к снимку"/)
})

/* Соцсети в подвале живут в своём поле блока, но те же три адреса
   уже лежат в настройках сайта — и когда поле забывали заполнить,
   подвал молча пустел. Пустое поле подхватывает настройки, как это
   давно делает логотип; своё заполненное главнее. */
test('подвал берёт соцсети из настроек, пока своих нет', async () => {
  const { pageId } = await buildPage()
  await setSetting('social', [
    { icon: 'instagram', label: 'Instagram', url: 'https://instagram.com/padali.band' },
    { icon: 'youtube', label: 'YouTube', url: 'https://youtube.com/@PADALIband' }
  ])

  const block = await createBlock({
    pageId, type: 'footer', settings: { ...defaultSettings('footer'), links: [] }
  })
  invalidateCache()

  const footerOf = (body) => /<footer[\s\S]*?<\/footer>/.exec(body)[0]
  let footer = footerOf((await app.inject({ method: 'GET', url: '/' })).body)
  assert.match(footer, /instagram\.com\/padali\.band/, 'взял из настроек')
  assert.match(footer, /youtube\.com\/@PADALIband/)

  /* Своё поле главнее: иначе редактор не смог бы показать в подвале
     что-то одно, не трогая настройки всего сайта. */
  await updateBlock(block, {
    settings: { ...defaultSettings('footer'), links: [{ icon: 'telegram', label: 'Telegram', url: 'https://t.me/padali' }] },
    anchor: null,
    isVisible: true
  })
  invalidateCache()

  footer = footerOf((await app.inject({ method: 'GET', url: '/' })).body)
  assert.match(footer, /t\.me\/padali/, 'показывает своё')
  assert.doesNotMatch(footer, /instagram\.com/, 'и только своё')
})

/* Раздел на странице есть, а в меню его нет — так выпадали «Мерч»
   и «Контакты»: запасная подпись объявлена в дескрипторе, но
   попадала в тексты только при создании блока, и у заведённых
   раньше поле осталось пустым. */
test('раздел без своей подписи всё равно попадает в меню', async () => {
  const { pageId } = await buildPage()

  const block = await createBlock({
    pageId, type: 'merch', anchor: 'merch', settings: defaultSettings('merch')
  })
  assert.ok(block)
  invalidateCache()

  const en = (await app.inject({ method: 'GET', url: '/' })).body
  const sr = (await app.inject({ method: 'GET', url: '/sr' })).body

  assert.match(en, /<a href="#merch">Merch<\/a>/, 'запасная подпись из дескриптора')
  assert.match(sr, /<a href="#merch">Merch<\/a>/, 'и на втором языке')

  /* Своя подпись по-прежнему главнее: дескриптор только подстилает. */
  await saveBlockTexts(block, { en: { nav_label: 'Shop' } })
  invalidateCache()
  const own = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(own, /<a href="#merch">Shop<\/a>/)
})

/* Вчерашний концерт — уже не «ближайший». Уходит он сам, по дате:
   правило «редактор вспомнит» не работает ни в одном проекте.
   «Сегодня» передаётся параметром — иначе тест пришлось бы
   привязывать к часам машины, на которой он идёт. */
test('прошедшие концерты уходят со страницы, оставшиеся — по возрастанию', async () => {
  const { composePage } = await import('../src/services/page-composer.js')
  const { pageId } = await buildPage()

  await createBlock({
    pageId, type: 'concert', anchor: 'shows',
    settings: {
      ...defaultSettings('concert'),
      events: [
        { date: '2026-12-05', tickets: 'door' },
        { date: '2026-10-16', tickets: 'link' },
        { date: '2020-01-01', tickets: 'door' }
      ]
    }
  })
  invalidateCache()

  const page = await composePage({ locale: 'en', today: '2026-11-01' })
  const block = page.blocks.find((item) => item.type === 'concert')

  assert.deepEqual(block.settings.events.map((event) => event.date), ['2026-12-05'],
    'прошедшие отброшены')

  const earlier = await composePage({ locale: 'en', today: '2026-01-01' })
  const dates = earlier.blocks.find((item) => item.type === 'concert').settings.events
    .map((event) => event.date)
  assert.deepEqual(dates, ['2026-10-16', '2026-12-05'], 'ближайший идёт первым')
})

/* Блок, которому нечего показать, не рисуется — значит, и пункт
   меню на него вёл бы в никуда: страница прокручивалась бы в
   случайное место. */
test('концерты без будущих событий исчезают и из меню', async () => {
  const { composePage } = await import('../src/services/page-composer.js')
  const { pageId } = await buildPage()

  const block = await createBlock({
    pageId, type: 'concert', anchor: 'shows',
    settings: { ...defaultSettings('concert'), events: [{ date: '2020-01-01', tickets: 'door' }] }
  })
  await saveBlockTexts(block, { en: { nav_label: 'Concerts' } })
  invalidateCache()

  const page = await composePage({ locale: 'en', today: '2026-11-01' })
  assert.deepEqual(page.quicknav.filter((item) => item.anchor === 'shows'), [],
    'пункта меню нет')

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  assert.doesNotMatch(body, /id="shows"/, 'и самого раздела нет')
})

/* Слово «от» набирали прямо в поле цены, одном на оба языка, и на
   сербской странице стоял английский предлог. Теперь это флажок, а
   слово берётся из словаря сайта. */
test('«цена от» переводится, а не набирается в поле', async () => {
  const { pageId } = await buildPage()

  await createBlock({
    pageId, type: 'concert', anchor: 'shows',
    settings: {
      ...defaultSettings('concert'),
      events: [{ date: soon(40), tickets: 'door', price: '1000 RSD', price_from: true }]
    }
  })
  invalidateCache()

  const en = (await app.inject({ method: 'GET', url: '/' })).body
  const sr = (await app.inject({ method: 'GET', url: '/sr' })).body

  assert.match(en, /concert-price">from 1000 RSD</)
  assert.match(sr, /concert-price">od 1000 RSD</)
  assert.doesNotMatch(sr, /from 1000 RSD/, 'английского предлога на сербской странице нет')
})

/* Разметка для поисковиков: без неё концерт не попадает в «События»
   Google. Прошедшие туда тоже не попадают — отсечка одна и та же. */
test('в разметке для поиска есть группа и будущий концерт', async () => {
  const { pageId } = await buildPage()

  await createBlock({
    pageId, type: 'concert', anchor: 'shows',
    settings: {
      ...defaultSettings('concert'),
      events: [{ date: '2099-12-05', tickets: 'door', price: '1000 RSD' }]
    }
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body)
  assert.ok(raw, 'разметки нет вовсе')

  const graph = JSON.parse(raw[1])['@graph']
  assert.equal(graph[0]['@type'], 'MusicGroup')
  assert.equal(graph[0].name, 'PADALI')

  const event = graph.find((node) => node['@type'] === 'MusicEvent')
  assert.ok(event, 'концерта в разметке нет')
  assert.equal(event.startDate, '2099-12-05')
  assert.deepEqual(
    { price: event.offers.price, currency: event.offers.priceCurrency },
    { price: '1000', currency: 'RSD' },
    'цена и валюта разобраны по отдельности: половинчатое предложение поиск отбрасывает'
  )
})

/* Без скрипта браузер приходит на /send сам. Показать ему голый
   JSON нельзя, а терять написанное — тем более: до правки у формы
   не было action, и текст сообщения уезжал в адресную строку. */
test('отправка формы без скрипта возвращает на страницу, а не в JSON', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/send',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'kind=contact&message=Привет&contact_kind=email&contact=a@b.rs&locale=sr'
  })

  assert.equal(response.statusCode, 303)
  assert.equal(response.headers.location, '/sr#contact')

  /* А скрипт по-прежнему получает JSON: он шлёт JSON-тело и
     заголовка Accept не ставит. */
  const ajax = await app.inject({
    method: 'POST',
    url: '/send',
    payload: { kind: 'contact', message: 'Привет', contact_kind: 'email', contact: 'a@b.rs' }
  })
  assert.equal(ajax.statusCode, 200)
  assert.deepEqual(ajax.json(), { ok: true })
})

/* «Пока неизвестно» — это отсутствие сведений, а не пустые поля:
   ссылка и цена могли остаться от прежнего способа продажи, и
   показать их значило бы продать билет, которого нет. */
test('пока неизвестно — ни кнопки, ни цены', async () => {
  const { pageId } = await buildPage()
  const show = soon(7)

  await createBlock({
    pageId, type: 'concert', anchor: 'tba',
    settings: {
      ...defaultSettings('concert'),
      events: [{
        date: show,
        tickets: 'unknown',
        ticket_url: 'https://tickets.example/старое',
        price: '800 RSD'
      }]
    }
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const section = /<section class="section wrap" id="tba">[\s\S]*?<\/section>/.exec(body)[0]

  assert.ok(section.includes(asShown(show)), 'дата остаётся')
  assert.doesNotMatch(section, /tickets\.example/, 'прежняя ссылка не всплывает')
  assert.doesNotMatch(section, /800 RSD/, 'прежняя цена не всплывает')
  assert.doesNotMatch(section, /concert-tickets/, 'строки билетов нет вовсе')
})

/* Два концерта листаются, как фотографии; один — просто карточка,
   без ленты и стрелок: листать нечего. */
test('несколько концертов листаются, один — нет', async () => {
  const { pageId } = await buildPage()

  const alone = await createBlock({
    pageId, type: 'concert', anchor: 'one',
    settings: { ...defaultSettings('concert'), events: [{ date: soon(7) }] }
  })
  assert.ok(alone)
  invalidateCache()

  let body = (await app.inject({ method: 'GET', url: '/' })).body
  let section = /<section class="section wrap" id="one">[\s\S]*?<\/section>/.exec(body)[0]
  assert.doesNotMatch(section, /gallery-frame--scrollable/)
  assert.doesNotMatch(section, /gallery-arrow/)

  await createBlock({
    pageId, type: 'concert', anchor: 'two',
    settings: {
      ...defaultSettings('concert'),
      events: [{ date: soon(7) }, { date: soon(40) }]
    }
  })
  invalidateCache()

  body = (await app.inject({ method: 'GET', url: '/' })).body
  section = /<section class="section wrap" id="two">[\s\S]*?<\/section>/.exec(body)[0]
  assert.match(section, /gallery-frame--scrollable/)
  assert.match(section, /data-gallery-scroll/)
  assert.match(section, /gallery-arrow--next/)
  assert.equal((section.match(/class="concert-grid/g) || []).length, 2)
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

test('страница ссылается на статику с отпечатком', async () => {
  await buildPage()
  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, /href="\/css\/site\.css\?v=[a-f0-9]{10}"/)
  assert.match(response.body, /src="\/js\/site\.js\?v=[a-f0-9]{10}"/)
})

/**
 * Альбом крупнее экрана листается вбок стрелками и свайпом, не
 * открывая фотографию. Экран складывает CSS из колонок: columns ×
 * rows на мониторе, columns_mobile × rows на телефоне. Шаблон
 * отдаёт сплошной список и числа, по которым его делить, — поделить
 * его здесь значило бы выбрать одну ширину экрана из двух.
 */
test('альбом крупнее экрана делится на страницы со стрелками', async () => {
  const { pageId } = await buildPage()

  const ids = []
  for (let seed = 30; seed < 37; seed += 1) {
    const { media } = await processUpload({
      buffer: await makeImage({ width: 400, height: 300, seed }),
      originalName: `p${seed}.png`,
      mime: 'image/png'
    })
    ids.push(media.id)
  }

  const album = await createGallery('many')
  await setGalleryItems(album, ids)
  await createBlock({
    pageId, type: 'gallery', anchor: 'many',
    settings: { ...defaultSettings('gallery'), gallery_id: album, columns: 3, rows: 2 }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  const section = /<section class="section wrap" id="many">[\s\S]*?<\/section>/.exec(response.body)[0]

  // Семь фотографий одним списком, а экран — три колонки на два ряда.
  assert.equal((section.match(/class="gallery-item"/g) || []).length, 7)
  assert.match(section, /--gallery-columns: 3/)
  assert.match(section, /--gallery-rows: 2/)
  assert.doesNotMatch(section, /gallery-page/, 'страницы не нарезаются в разметке')
  assert.match(section, /gallery-frame--scrollable/)
  assert.match(section, /gallery-arrow--prev/)
  assert.match(section, /gallery-arrow--next/)
  assert.equal((section.match(/data-lightbox-group/g) || []).length, 1,
    'группа листания одна на весь альбом, а не на экран')
  assert.equal((section.match(/data-lightbox=/g) || []).length, 7)
})

test('альбом, помещающийся на экран, страниц не получает', async () => {
  const { pageId, mediaId } = await buildPage()
  const album = await createGallery('few')
  await setGalleryItems(album, [mediaId])
  await createBlock({
    pageId, type: 'gallery', anchor: 'few',
    settings: { ...defaultSettings('gallery'), gallery_id: album, columns: 3, rows: 2 }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  const section = /<section class="section wrap" id="few">[\s\S]*?<\/section>/.exec(response.body)[0]
  assert.doesNotMatch(section, /gallery-page/)
  assert.doesNotMatch(section, /gallery-arrow/)
})

test('лента получает стрелки независимо от числа строк', async () => {
  const { pageId, mediaId } = await buildPage()
  const album = await createGallery('strip')
  await setGalleryItems(album, [mediaId])
  await createBlock({
    pageId, type: 'gallery', anchor: 'strip',
    settings: { ...defaultSettings('gallery'), gallery_id: album, layout: 'strip' }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  const section = /<section class="section wrap" id="strip">[\s\S]*?<\/section>/.exec(response.body)[0]
  assert.match(section, /gallery--strip/)
  assert.match(section, /data-gallery-scroll/)
  assert.match(section, /gallery-arrow--next/)
})

test('две галереи получают разные группы листания', async () => {
  const { pageId, mediaId } = await buildPage()

  const second = await createGallery('backstage')
  await saveGalleryTexts(second, { en: { title: 'Backstage' } })
  await setGalleryItems(second, [mediaId])
  await createBlock({
    pageId, type: 'gallery', anchor: 'backstage',
    settings: { ...defaultSettings('gallery'), gallery_id: second }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  const groups = [...response.body.matchAll(/data-lightbox-group="([^"]+)"/g)].map((m) => m[1])

  assert.equal(groups.length, 2, 'по группе на галерею')
  assert.equal(new Set(groups).size, 2, 'группы различаются, иначе альбомы перемешаются при листании')
})

test('у галереи с выключенным лайтбоксом группы нет', async () => {
  const { pageId, mediaId } = await buildPage()
  const album = await createGallery('plain')
  await setGalleryItems(album, [mediaId])
  await createBlock({
    pageId, type: 'gallery',
    settings: { ...defaultSettings('gallery'), gallery_id: album, lightbox: false }
  })
  invalidateCache()

  const response = await app.inject({ method: 'GET', url: '/' })
  const withoutLightbox = response.body.split('data-lightbox-group').length - 1
  assert.equal(withoutLightbox, 1, 'группа только у галереи, где просмотр включён')
})

/* ─── Сброс кэша после записи ────────────────────────────── */

/**
 * Страницы лежат в кэше процесса и сбрасываются только вызовом
 * afterWrite() в пишущих маршрутах. Забытый вызов в новом маршруте
 * ничем себя не проявит: в разработке страница перерисовывается,
 * а в проде посетитель будет видеть старую до следующей записи.
 * Поэтому проверяем сквозняком, через настоящее сохранение.
 */
test('правка из админки видна на сайте сразу', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({
    pageId, type: 'richtext', isVisible: true, settings: defaultSettings('richtext')
  })
  await saveBlockTexts(id, { en: { heading: 'Было' }, sr: {} })

  await createTestAdmin()
  const session = await loginAs(app)

  // Первый заход кладёт страницу в кэш.
  assert.match((await app.inject({ method: 'GET', url: '/' })).body, /Было/)

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, is_visible: 'on', 'text[en][heading]': 'Стало' })
  })

  const after = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(after, /Стало/, 'кэш сброшен записью, а не вручную')
  assert.doesNotMatch(after, /Было/)
})

test('удаление блока тоже сбрасывает кэш', async () => {
  const pageId = await createPage({ slug: 'home' })
  const id = await createBlock({
    pageId, type: 'richtext', isVisible: true, settings: defaultSettings('richtext')
  })
  await saveBlockTexts(id, { en: { heading: 'Исчезнет' }, sr: {} })

  await createTestAdmin()
  const session = await loginAs(app)

  assert.match((await app.inject({ method: 'GET', url: '/' })).body, /Исчезнет/)

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${id}/delete`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })

  assert.doesNotMatch((await app.inject({ method: 'GET', url: '/' })).body, /Исчезнет/)
})

/* Сингл выходит ночью, а правит страницу человек утром. Поэтому
   блок релиза переключается сам по дате: до выхода — отсчёт и
   «скоро», после — «слушать» и площадки ссылками. Обе стороны
   проверяем через composePage с подставленным «сегодня»: трогать
   часы машины ради теста нельзя. */
test('блок релиза сам переключается с «скоро» на «слушать»', async () => {
  const { pageId } = await buildPage()

  const id = await createBlock({
    pageId, type: 'release', anchor: 'single',
    settings: {
      ...defaultSettings('release'),
      release_date: '2026-10-22',
      show_countdown: true,
      platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/padali' }]
    }
  })
  await saveBlockTexts(id, {
    en: { platforms_label: 'Soon on', countdown_label: '{days} days until release' }
  })
  invalidateCache()

  const { render } = await import('../src/services/renderer.js')
  const { composePage } = await import('../src/services/page-composer.js')
  const { buildJsonLd } = await import('../src/services/json-ld.js')

  async function pageOn (today) {
    const page = await composePage({ locale: 'en', today })
    return render('layout', { ...page, ogImage: null, jsonLd: buildJsonLd(page) })
  }

  const before = await pageOn('2026-10-21')
  assert.match(before, /data-countdown="2026-10-22"/, 'до выхода отсчёт идёт')
  assert.match(before, /Soon on/, 'подпись «скоро» на месте')
  assert.doesNotMatch(before, /platform-icons--out/, 'ряд ещё не главная кнопка')
  assert.doesNotMatch(before, /platform-name/, 'имя площадки рядом со знаком не нужно')

  /* День выхода — уже «вышел»: релиз появляется ночью по местному
     времени площадок, и ждать следующих суток незачем. */
  for (const today of ['2026-10-22', '2026-11-30']) {
    const after = await pageOn(today)
    assert.doesNotMatch(after, /data-countdown=/, `${today}: отсчёту считать нечего`)
    assert.doesNotMatch(after, /Soon on/, `${today}: «скоро» ушло`)
    assert.match(after, /platforms-label--out/, `${today}: подпись сменилась`)
    assert.match(after, /Listen now/, `${today}: запасная подпись из словаря сайта`)
    assert.match(after, /platform-icons--out/, `${today}: ряд стал главной кнопкой`)
    assert.match(after, /class="platform-name">Spotify</, `${today}: имя площадки рядом со знаком`)
  }
})

/* Своя подпись главнее запасной, и на втором языке тоже. */
test('подпись после выхода берётся из поля, если редактор её вписал', async () => {
  const { pageId } = await buildPage()

  const id = await createBlock({
    pageId, type: 'release', anchor: 'single',
    settings: {
      ...defaultSettings('release'),
      release_date: '2026-10-22',
      platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/padali' }]
    }
  })
  await saveBlockTexts(id, { en: { listen_label: 'OUT NOW' }, sr: { listen_label: 'IZAŠLO' } })
  invalidateCache()

  const { render } = await import('../src/services/renderer.js')
  const { composePage } = await import('../src/services/page-composer.js')
  const { buildJsonLd } = await import('../src/services/json-ld.js')

  for (const [locale, expected] of [['en', 'OUT NOW'], ['sr', 'IZAŠLO']]) {
    const page = await composePage({ locale, today: '2026-10-25' })
    const html = render('layout', { ...page, ogImage: null, jsonLd: buildJsonLd(page) })
    assert.match(html, new RegExp(`platforms-label--out">${expected}<`), `на ${locale}`)
    assert.doesNotMatch(html, /Listen now|Slušaj odmah/, `на ${locale} запасная не лезет поверх своей`)
  }
})

/* Последняя кнопка ряда ведёт на страницу, где собраны все
   площадки сразу. Поле адреса отдельно от подписи: подпись
   переводится, адрес — нет, как и у самих площадок. */
test('кнопка «ещё» становится ссылкой, когда ей задан адрес', async () => {
  const { pageId } = await buildPage()

  async function releaseBlock (anchor, moreUrl) {
    const id = await createBlock({
      pageId, type: 'release', anchor,
      settings: {
        ...defaultSettings('release'),
        release_date: '2026-10-22',
        more_url: moreUrl,
        platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/x' }]
      }
    })
    await saveBlockTexts(id, { en: { more_label: '+ more' } })
  }

  await releaseBlock('with-url', 'https://padali.band/pocetak')
  await releaseBlock('inside', '/pocetak')
  await releaseBlock('no-url', '')
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  const cut = (anchor) => new RegExp(`id="${anchor}">[\\s\\S]*?</section>`).exec(body)[0]

  const withUrl = cut('with-url')
  assert.match(withUrl, /<a class="more" href="https:\/\/padali\.band\/pocetak" target="_blank" rel="noopener">\+ more<\/a>/)
  assert.doesNotMatch(withUrl, /more--flat/, 'подписью она быть перестала')

  /* Своя страница открывается в этой же вкладке: новая нужна,
     чтобы не терять наш сайт, а тут мы с него и не уходим. */
  const inside = cut('inside')
  assert.match(inside, /<a class="more" href="\/pocetak">\+ more<\/a>/)
  assert.doesNotMatch(inside, /class="more"[^>]*target/, 'без новой вкладки')

  /* Без адреса — подпись «и другие». Врать ссылкой в никуда хуже,
     чем оставить надпись. */
  const without = cut('no-url')
  assert.match(without, /<span class="more more--flat">\+ more<\/span>/)
  assert.doesNotMatch(without, /<a class="more"/, 'ссылки в никуда нет')
})

/* Вторая страница живёт по своему адресу, и адрес из одного
   отрезка разбирается в два захода: сперва язык, потом слаг.
   Двух маршрутов «/:что-то» рядом быть не может, и именно этот
   разбор легко сделать так, что страница с коротким именем
   окажется недостижимой. */
test('страница по слагу открывается, на втором языке — с префиксом', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()

  const landingId = await makePage({ slug: 'pocetak' })
  const block = await createBlock({
    pageId: landingId, type: 'richtext', anchor: 'text', isVisible: true,
    settings: defaultSettings('richtext')
  })
  await saveBlockTexts(block, { en: { body: '<p>Landing body</p>' }, sr: { body: '<p>Tekst stranice</p>' } })
  invalidateCache()

  const en = await app.inject({ method: 'GET', url: '/pocetak' })
  assert.equal(en.statusCode, 200)
  assert.match(en.body, /Landing body/)

  const sr = await app.inject({ method: 'GET', url: '/sr/pocetak' })
  assert.equal(sr.statusCode, 200)
  assert.match(sr.body, /Tekst stranice/)

  /* Главная отзывается только из корня: та же страница по двум
     адресам — два разных документа для поисковика. */
  assert.equal((await app.inject({ method: 'GET', url: '/home' })).statusCode, 301)
  assert.equal((await app.inject({ method: 'GET', url: '/en/pocetak' })).statusCode, 301)

  // Язык по-прежнему разбирается первым и страницу не заслоняет.
  assert.equal((await app.inject({ method: 'GET', url: '/sr' })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/нет-такой' })).statusCode, 404)
})

/* Неопубликованная страница не отдаётся и в карту сайта не
   попадает: иначе поисковик придёт по ссылке на 404. */
test('неопубликованная страница скрыта и из выдачи, и из карты сайта', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()

  const hidden = await makePage({ slug: 'draft', isPublished: false })
  await createBlock({
    pageId: hidden, type: 'richtext', anchor: 'text', isVisible: true,
    settings: defaultSettings('richtext')
  })
  await makePage({ slug: 'pocetak' })
  invalidateCache()

  assert.equal((await app.inject({ method: 'GET', url: '/draft' })).statusCode, 404)

  const map = (await app.inject({ method: 'GET', url: '/sitemap.xml' })).body
  assert.doesNotMatch(map, /\/draft</, 'черновика в карте нет')
  assert.match(map, /<loc>[^<]*\/pocetak<\/loc>/, 'опубликованная есть')
  assert.match(map, /<loc>[^<]*\/sr\/pocetak<\/loc>/, 'и на втором языке')
  assert.match(map, /<loc>[^<]*\/<\/loc>/, 'главная осталась в корне')
})

/* Точный отрезок адреса важнее параметра, параметр важнее
   звёздочки — так выбирает маршрут find-my-way. Пока статика
   висела звёздочкой на корне, появившийся разбор страниц
   «/:язык/:слаг» перехватил «/css/site.css»: язык «css», слаг
   «site.css». Сайт остался без стилей, и выглядело это как
   поломка вёрстки, а не маршрутов. */
test('файлы стилей и скриптов не перехватываются разбором страниц', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()
  await makePage({ slug: 'pocetak' })
  invalidateCache()

  for (const url of ['/css/site.css', '/css/admin.css', '/js/site.js', '/js/admin.js']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200, `${url} отдаётся`)
    assert.ok(response.body.length > 100, `${url} не пустой`)
  }

  /* Два отрезка — и первый из двух букв, как у языка: «js» ловится
     ровно тем же правилом, которым ловился бы «sr». */
  assert.doesNotMatch(
    (await app.inject({ method: 'GET', url: '/js/site.js' })).headers['content-type'] ?? '',
    /text\/html/,
    'это файл, а не страница'
  )
})

/* ─── Лендинг релиза ────────────────────────────────────────
   Страница, которую питчат: на ней одна запись и один вопрос —
   где её слушать. Поэтому ни шапки сайта, ни меню, ни подвала:
   уводить внимание в мерч и фотографии отсюда незачем. */
test('лендинг показывается без шапки, меню и подвала сайта', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()

  const landingPage = await makePage({ slug: 'pocetak' })
  const block = await createBlock({
    pageId: landingPage, type: 'landing', anchor: 'listen', isVisible: true,
    settings: {
      ...defaultSettings('landing'),
      spotify_url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/x' }]
    }
  })
  await saveBlockTexts(block, { en: { title: 'POČETAK', platforms_label: 'Get the music' } })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/pocetak' })).body

  assert.doesNotMatch(body, /class="topbar"/, 'шапки сайта нет')
  assert.doesNotMatch(body, /class="quicknav"/, 'меню разделов нет')
  assert.doesNotMatch(body, /class="wrap site-footer"/, 'подвала сайта нет')

  assert.match(body, /class="landing-hero"/)
  assert.match(body, /POČETAK/)
  assert.match(body, /Get the music/)

  /* Главная при этом остаётся с шапкой: признак объявлен у блока,
     а не включён для всего сайта. */
  const home = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(home, /class="topbar"/, 'на главной шапка на месте')
})

/* Плеер — чужая рамка, и адрес ей нужен особый: на обычную
   страницу Spotify внутри iframe показывает весь сервис целиком
   вместо одного трека. */
test('ссылка Spotify превращается в плеер, мусор — ни во что', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()

  async function landingWith (slug, spotifyUrl) {
    const pageId = await makePage({ slug })
    await createBlock({
      pageId, type: 'landing', anchor: 'listen', isVisible: true,
      settings: { ...defaultSettings('landing'), spotify_url: spotifyUrl }
    })
  }

  await landingWith('good', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  await landingWith('bad', 'https://example.com/not-spotify')
  invalidateCache()

  const good = (await app.inject({ method: 'GET', url: '/good' })).body
  assert.match(good, /src="https:\/\/open\.spotify\.com\/embed\/track\/4cOdK2wGLETKBW3PvgPWqT\?theme=0"/)

  const bad = (await app.inject({ method: 'GET', url: '/bad' })).body
  assert.doesNotMatch(bad, /<iframe/, 'чужая ссылка рамку не открывает')
  assert.doesNotMatch(bad, /example\.com/, 'и в разметку не попадает')
})

/* Лендинг кидают ссылкой в чат и в сторис, и там видно картинку
   предпросмотра. Общая фотография группы на странице одного
   трека читается как ссылка на сайт вообще. */
test('картинкой предпросмотра у лендинга становится обложка релиза', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  const { processUpload: upload } = await import('../src/services/media-processor.js')
  await buildPage()

  const { media: cover } = await upload({
    buffer: await makeImage({ width: 600, height: 600, seed: 42 }),
    originalName: 'cover.png',
    mime: 'image/png'
  })

  const pageId = await makePage({ slug: 'pocetak' })
  const block = await createBlock({
    pageId, type: 'landing', anchor: 'listen', isVisible: true,
    settings: defaultSettings('landing')
  })
  await saveBlockMedia(block, { cover: [cover.id] })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/pocetak' })).body
  const og = /<meta property="og:image" content="([^"]*)"/.exec(body)
  assert.ok(og, 'картинка предпросмотра объявлена')
  assert.match(og[1], /\/uploads\//, 'и это загруженный файл, а не пусто')
  assert.ok(og[1].includes(String(cover.hash).slice(0, 12)), 'адрес ведёт именно на обложку')
})

/* Лендинг рассылают ссылкой, и поисковик с мессенджером смотрят
   на canonical и og:url. Пока путь страницы до вёрстки не
   доезжал, оба показывали на главную: ссылка на один трек
   разворачивалась в «сайт группы» вообще. */
test('canonical и og:url второй страницы ведут на неё саму', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()
  const pageId = await makePage({ slug: 'pocetak' })
  await createBlock({
    pageId, type: 'landing', anchor: 'listen', isVisible: true,
    settings: defaultSettings('landing')
  })
  invalidateCache()

  const body = (await app.inject({ method: 'GET', url: '/pocetak' })).body
  assert.match(body, /<link rel="canonical" href="[^"]*\/pocetak">/)
  assert.match(body, /<meta property="og:url" content="[^"]*\/pocetak">/)
  assert.match(body, /hreflang="sr" href="[^"]*\/sr\/pocetak"/, 'второй язык — со своим префиксом')

  const home = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(home, /<link rel="canonical" href="[^"]*\/">/, 'главная осталась в корне')
  assert.doesNotMatch(home, /canonical[^>]*pocetak/, 'и чужого слага не подхватила')
})

/* Редактор пишет путь один раз, а читатель приходит на сербскую
   главную — и должен попасть на сербский лендинг, а не на
   английский. Внешние адреса не трогаем: чужому сайту наш
   префикс не нужен. */
test('внутренняя ссылка уводит на страницу своего языка', async () => {
  const { pageId } = await buildPage()

  const own = await createBlock({
    pageId, type: 'release', anchor: 'own',
    settings: {
      ...defaultSettings('release'),
      release_date: '2026-10-22',
      more_url: '/pocetak',
      platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/x' }]
    }
  })
  await saveBlockTexts(own, { en: { more_label: '+ more' }, sr: { more_label: '+ još' } })

  const away = await createBlock({
    pageId, type: 'release', anchor: 'away',
    settings: {
      ...defaultSettings('release'),
      release_date: '2026-10-22',
      more_url: 'https://hearnow.test/padali',
      platforms: [{ icon: 'spotify', label: 'Spotify', url: 'https://open.spotify.test/x' }]
    }
  })
  await saveBlockTexts(away, { en: { more_label: '+ more' }, sr: { more_label: '+ još' } })
  invalidateCache()

  const en = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(en, /<a class="more" href="\/pocetak">/, 'на языке по умолчанию префикса нет')

  const sr = (await app.inject({ method: 'GET', url: '/sr' })).body
  assert.match(sr, /<a class="more" href="\/sr\/pocetak">/, 'на сербской странице — сербский лендинг')

  assert.match(sr, /href="https:\/\/hearnow\.test\/padali"/, 'чужой адрес остался как был')
})

/* Купить пока негде, но ссылка у редактора уже есть. Тумблер
   отдельно от адреса: выключенная кнопка хранит его и
   возвращается целиком, когда появится где. */
test('кнопку покупки на лендинге включает отдельный тумблер', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()

  async function landing (slug, showBuy) {
    const pageId = await makePage({ slug })
    const id = await createBlock({
      pageId, type: 'landing', anchor: 'listen', isVisible: true,
      settings: {
        ...defaultSettings('landing'),
        show_buy: showBuy,
        buy_url: 'https://padali.bandcamp.test/'
      }
    })
    await saveBlockTexts(id, { en: { buy_label: 'Buy from artist' } })
  }

  await landing('on', true)
  await landing('off', false)
  invalidateCache()

  const on = (await app.inject({ method: 'GET', url: '/on' })).body
  assert.match(on, /class="landing-buy"/)
  assert.match(on, /Buy from artist/)

  const off = (await app.inject({ method: 'GET', url: '/off' })).body
  assert.doesNotMatch(off, /class="landing-buy"/, 'кнопки нет')
  assert.doesNotMatch(off, /bandcamp\.test/, 'и адрес на страницу не попал')
})

/* Кнопка «поделиться» копирует адрес в буфер. Видимые строки
   скрипт берёт из разметки: языка интерфейса он не знает и знать
   не должен. Адрес тоже из разметки — свой канонический, а не тот,
   что в строке браузера: там бывают метки перехода и якорь, и
   отправлять такое друзьям незачем. */
test('кнопка «поделиться» несёт канонический адрес и подписи на своём языке', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  await buildPage()
  const pageId = await makePage({ slug: 'pocetak' })
  await createBlock({
    pageId, type: 'landing', anchor: 'listen', isVisible: true,
    settings: defaultSettings('landing')
  })
  invalidateCache()

  const en = (await app.inject({ method: 'GET', url: '/pocetak' })).body
  const button = /<button[^>]*data-share[\s\S]*?<\/button>/.exec(en)
  assert.ok(button, 'кнопка на странице есть')
  assert.match(button[0], /data-share="[^"]*\/pocetak"/, 'адрес канонический, без лишнего')
  assert.match(button[0], /data-copied="Link copied"/)
  assert.match(button[0], /data-failed="[^"]+"/, 'отказ тоже назван: молчащая кнопка выглядит сломанной')
  assert.match(button[0], /<svg/, 'со значком')
  assert.match(button[0], />Share<\/button>/)

  /* Своя страница на своём языке: сербский читатель делится
     сербским адресом. */
  const sr = (await app.inject({ method: 'GET', url: '/sr/pocetak' })).body
  const srButton = /<button[^>]*data-share[\s\S]*?<\/button>/.exec(sr)[0]
  assert.match(srButton, /data-share="[^"]*\/sr\/pocetak"/)
  assert.match(srButton, /data-copied="Link je kopiran"/)
  assert.match(srButton, />Podeli<\/button>/)

  // Место, куда скрипт кладёт сообщение, тоже должно быть на странице.
  assert.match(en, /data-toast[^>]*role="status"/, 'читалка экрана произнесёт появившееся')
})
