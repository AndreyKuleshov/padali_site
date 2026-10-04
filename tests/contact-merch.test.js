/**
 * Контакты и мерч.
 *
 * Главное здесь — что написанное человеком не теряется: сообщение
 * ложится в базу раньше, чем делается попытка письма, и остаётся
 * там, даже если почта молчит.
 */
import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockTexts } from '../src/repositories/blocks.js'
import {
  createGallery, setGalleryItems, getGalleryItems, itemFieldsForGalleries
} from '../src/repositories/galleries.js'
import { processUpload } from '../src/services/media-processor.js'
import { listMessages, countUnread } from '../src/repositories/messages.js'
import { defaultSettings } from '../src/blocks/index.js'
import { sendMessage, isMailConfigured } from '../src/services/mail.js'
import {
  checkContact, looksValid, normalizeHandle
} from '../src/services/contact-check.js'

let app
let auth
let pageId

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  app = await createTestServer()
  auth = await loginAs(app)
  pageId = await createPage({ slug: 'home' })
})

after(async () => { await closePool() })

function send (payload) {
  return app.inject({ method: 'POST', url: '/send', payload })
}

async function photo (seed) {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 600, height: 600, seed }),
    originalName: `shirt-${seed}.png`,
    mime: 'image/png'
  })
  return media.id
}

/* ─── Приём сообщений ────────────────────────────────────── */

test('сообщение из формы связи сохраняется', async () => {
  const response = await send({ kind: 'contact', message: 'Привет, хотим вас на фестиваль', contact: 'a@b.rs' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true })

  const [saved] = await listMessages()
  assert.equal(saved.kind, 'contact')
  assert.equal(saved.body, 'Привет, хотим вас на фестиваль')
  assert.equal(saved.contact, 'a@b.rs')
  assert.equal(saved.isRead, false)
  assert.equal(await countUnread(), 1)
})

test('заказ сохраняет город, связь и товар', async () => {
  await send({
    kind: 'order', city: 'Novi Sad', contact_kind: 'instagram', contact: '@padalifan',
    item: 'Футболка — 2500 RSD', message: 'размер L'
  })

  const [saved] = await listMessages()
  assert.equal(saved.kind, 'order')
  assert.equal(saved.city, 'Novi Sad')
  assert.equal(saved.contact, 'Instagram: @padalifan', 'вид связи виден в списке')
  assert.equal(saved.item, 'Футболка — 2500 RSD')
  assert.equal(saved.body, 'размер L')
})

/** Почта не настроена — но сообщение обязано дойти до админки. */
test('без настроенной почты сообщение всё равно в базе', async () => {
  assert.equal(isMailConfigured(), false, 'в тестах SMTP не задан')

  await send({ kind: 'contact', message: 'Проверка' })

  const [saved] = await listMessages()
  assert.equal(saved.body, 'Проверка')
  assert.equal(saved.mailedAt, null)
  assert.ok(saved.mailError, 'причина, почему письмо не ушло, записана')
})

test('письмо без текста и заказ без связи отклоняются', async () => {
  assert.equal((await send({ kind: 'contact', message: '   ' })).statusCode, 400)
  assert.equal((await send({ kind: 'order', city: 'Niš', contact_kind: 'email', contact: '' })).statusCode, 400)
  assert.equal((await listMessages()).length, 0)
})

/** Робот заполняет все поля подряд, человек приманку не видит. */
test('заполненная приманка отбрасывает отправку молча', async () => {
  const response = await send({ kind: 'contact', message: 'спам', website: 'http://spam' })

  assert.equal(response.statusCode, 200, 'роботу отвечаем как при успехе')
  assert.deepEqual(response.json(), { ok: true })
  assert.equal((await listMessages()).length, 0)
})

test('слишком длинный текст обрезается до размера колонки', async () => {
  await send({ kind: 'contact', message: 'я'.repeat(5000), contact: 'x'.repeat(400) })

  const [saved] = await listMessages()
  assert.equal(saved.body.length, 4000)
  assert.equal(saved.contact.length, 256)
})

test('без настроек письмо не отправляется и не падает', async () => {
  const result = await sendMessage({ kind: 'contact', body: 'текст' }, { settings: { host: '', to: '' } })
  assert.deepEqual(result, { ok: false, error: 'mail not configured' })
})

test('сорванная отправка возвращает причину, а не исключение', async () => {
  const result = await sendMessage(
    { kind: 'contact', body: 'текст' },
    {
      settings: { host: 'smtp.test', port: 587, from: 'a@b', to: 'c@d' },
      transporter: { sendMail: async () => { throw new Error('ECONNREFUSED') } }
    }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /ECONNREFUSED/)
})

/** Отвечать надо человеку; в поле связи пишут и телеграм. */
test('адрес из поля связи становится Reply-To, а ник — нет', async () => {
  const sent = []
  const transporter = { sendMail: async (mail) => { sent.push(mail) } }
  const settings = { host: 'smtp.test', port: 587, from: 'a@b', to: 'c@d' }

  await sendMessage({ kind: 'contact', body: 'текст', contact: 'fan@mail.rs' }, { settings, transporter })
  await sendMessage({ kind: 'contact', body: 'текст', contact: '@padalifan' }, { settings, transporter })

  assert.equal(sent[0].replyTo, 'fan@mail.rs')
  assert.equal(sent[1].replyTo, undefined)
})

/* ─── Блок контактов ─────────────────────────────────────── */

test('блок контактов показывает адрес и форму', async () => {
  const id = await createBlock({
    pageId, type: 'contact', isVisible: true, settings: defaultSettings('contact')
  })
  await saveBlockTexts(id, { en: { heading: 'Contacts' }, sr: {} })

  const response = await app.inject({ method: 'GET', url: '/' })

  assert.match(response.body, /mailto:padaliband@gmail\.com/)
  assert.match(response.body, /data-send-form/)
  assert.match(response.body, /name="website"/, 'приманка на месте')
  assert.doesNotMatch(response.body, /type="file"/, 'вложений в форме нет')
})

test('форму можно выключить, оставив адрес', async () => {
  await createBlock({
    pageId,
    type: 'contact',
    isVisible: true,
    settings: { ...defaultSettings('contact'), show_form: false }
  })

  const response = await app.inject({ method: 'GET', url: '/' })
  assert.match(response.body, /mailto:padaliband@gmail\.com/)
  assert.doesNotMatch(response.body, /data-send-form/)
})

/* ─── Блок мерча ─────────────────────────────────────────── */

test('кнопку заказа получает только фотография с ценой', async () => {
  const withPrice = await photo(31)
  const without = await photo(32)
  const album = await createGallery('merch')
  await setGalleryItems(album, [{ mediaId: withPrice, price: '2500 RSD' }, without])

  await createBlock({
    pageId,
    type: 'merch',
    isVisible: true,
    settings: { ...defaultSettings('merch'), gallery_id: album }
  })

  const response = await app.inject({ method: 'GET', url: '/' })
  const buttons = response.body.match(/merch-order/g) ?? []

  assert.equal(buttons.length, 1, 'вторая фотография без цены кнопки не получает')
  assert.match(response.body, /2500 RSD/)
  assert.match(response.body, /data-order-dialog/)
})

test('цена переживает перезапись состава альбома', async () => {
  const first = await photo(33)
  const second = await photo(34)
  const album = await createGallery('merch')

  await setGalleryItems(album, [{ mediaId: first, price: '2500 RSD' }])
  await setGalleryItems(album, [
    { mediaId: second, price: '1200 RSD' },
    { mediaId: first, price: '2500 RSD' }
  ])

  const fields = (await itemFieldsForGalleries([album])).get(album)
  assert.equal(fields.get(first).price, '2500 RSD')
  assert.equal(fields.get(second).price, '1200 RSD')
  assert.deepEqual(await getGalleryItems(album), [second, first], 'порядок — как прислали')
})

/** Старые вызовы передают голые id; ломать их нельзя. */
test('состав без цен сохраняется по-прежнему', async () => {
  const id = await photo(35)
  const album = await createGallery('plain')
  await setGalleryItems(album, [id])

  assert.deepEqual(await getGalleryItems(album), [id])
  assert.equal((await itemFieldsForGalleries([album])).size, 0)
})

test('цена сохраняется из формы альбома', async () => {
  const id = await photo(36)
  const album = await createGallery('merch')
  await setGalleryItems(album, [id])

  await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}`,
    cookies: auth.cookies,
    ...form({
      _csrf: auth.csrf, slug: 'merch', items: String(id),
      [`price[m${id}]`]: '2500 RSD'
    })
  })

  const fields = (await itemFieldsForGalleries([album])).get(album)
  assert.equal(fields.get(id).price, '2500 RSD')
})

/* ─── Админка ────────────────────────────────────────────── */

test('сообщения видны в админке и помечаются прочитанными', async () => {
  await send({ kind: 'contact', message: 'Позовите нас играть', contact: 'club@ns.rs' })
  const [saved] = await listMessages()

  const page = await app.inject({ method: 'GET', url: '/admin/messages', cookies: auth.cookies })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /Позовите нас играть/)
  assert.match(page.body, /club@ns\.rs/)

  await app.inject({
    method: 'POST',
    url: `/admin/messages/${saved.id}/read`,
    cookies: auth.cookies,
    ...form({ _csrf: auth.csrf, read: 'on' })
  })

  assert.equal(await countUnread(), 0)
})

test('сообщение удаляется', async () => {
  await send({ kind: 'contact', message: 'тест' })
  const [saved] = await listMessages()

  await app.inject({
    method: 'POST',
    url: `/admin/messages/${saved.id}/delete`,
    cookies: auth.cookies,
    ...form({ _csrf: auth.csrf })
  })

  assert.equal((await listMessages()).length, 0)
})

test('чужим сообщения не показываются', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin/messages' })
  assert.notEqual(response.statusCode, 200)
})

test('оба блока есть в конструкторе', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin', cookies: auth.cookies })
  assert.match(response.body, /value="contact"/)
  assert.match(response.body, /value="merch"/)
})

/* ─── Альбом из формы блока ──────────────────────────────── */

/**
 * Редактор заполнил блок мерча и обнаружил, что альбома нет.
 * Переход на страницу альбомов терял незаписанную форму, поэтому
 * альбом заводится отдельным ответом, без ухода со страницы.
 */
test('альбом создаётся из формы блока и сразу годится для выбора', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/galleries.json',
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, slug: 'Новый Merch 2026' }
  })

  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.ok(Number.isInteger(body.id))
  // Кириллицу slugify оставляет намеренно: по короткому имени
  // альбом ищут в админке, в адреса страниц оно не попадает.
  assert.equal(body.slug, 'новый-merch-2026', 'пробелы в дефисы, регистр вниз')
  assert.match(body.label, /\(0\)/, 'подпись готова для пункта списка')

  const id = await createBlock({
    pageId, type: 'merch', isVisible: true,
    settings: { ...defaultSettings('merch'), gallery_id: body.id }
  })
  assert.ok(id)
})

test('повтор короткого имени отклоняется с объяснением', async () => {
  await createGallery('merch')

  const response = await app.inject({
    method: 'POST',
    url: '/admin/galleries.json',
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, slug: 'merch' }
  })

  assert.equal(response.statusCode, 409)
  assert.equal(response.json().ok, false)
  assert.match(response.json().message, /merch/)
})

test('пустое имя отклоняется', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/galleries.json',
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, slug: '   ' }
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().ok, false)
})

test('создание альбома закрыто для чужих', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/galleries.json', payload: { slug: 'sneaky' }
  })
  assert.notEqual(response.statusCode, 200)
})

test('в форме блока есть кнопка нового альбома, а переход — в новой вкладке', async () => {
  const id = await createBlock({
    pageId, type: 'merch', settings: defaultSettings('merch')
  })

  const body = (await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: auth.cookies
  })).body

  assert.match(body, /data-new-album/)
  assert.match(body, /id="albumDialog"/)
  assert.match(body, /href="\/admin\/galleries" target="_blank"/,
    'уход на страницу альбомов не уносит незаписанную форму')
})

/* ─── Наполнение альбома из формы блока ──────────────────── */

test('состав альбома отдаётся формой блока', async () => {
  const album = await createGallery('merch')
  const first = await photo(41)
  await setGalleryItems(album, [{ mediaId: first, price: '2500 RSD' }])

  const response = await app.inject({
    method: 'GET', url: `/admin/galleries/${album}/items.json`, cookies: auth.cookies
  })

  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.count, 1)
  assert.equal(body.items[0].id, first)
  assert.match(body.items[0].thumb, /^\/uploads\//)
})

/** Форма блока про состав альбома не знает — стереть его нельзя. */
test('дозагрузка дописывает в конец и не трогает цены', async () => {
  const album = await createGallery('merch')
  const first = await photo(42)
  const second = await photo(43)
  await setGalleryItems(album, [{ mediaId: first, price: '2500 RSD' }])

  const response = await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}/items.json`,
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, media: [second] }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().added, 1)
  assert.deepEqual(await getGalleryItems(album), [first, second], 'новое в конце')

  const fields = (await itemFieldsForGalleries([album])).get(album)
  assert.equal(fields.get(first).price, '2500 RSD', 'цена уцелела')
})

test('повторная фотография не задваивается', async () => {
  const album = await createGallery('merch')
  const id = await photo(44)
  await setGalleryItems(album, [id])

  const response = await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}/items.json`,
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, media: [id] }
  })

  assert.equal(response.json().added, 0)
  assert.deepEqual(await getGalleryItems(album), [id])
})

test('пустой список и чужой альбом отклоняются', async () => {
  const album = await createGallery('merch')

  const empty = await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}/items.json`,
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, media: [] }
  })
  assert.equal(empty.statusCode, 400)

  const missing = await app.inject({
    method: 'POST',
    url: '/admin/galleries/99999/items.json',
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, media: [1] }
  })
  assert.equal(missing.statusCode, 404)
})

test('состав альбома закрыт для чужих', async () => {
  const album = await createGallery('merch')
  const response = await app.inject({ method: 'GET', url: `/admin/galleries/${album}/items.json` })
  assert.notEqual(response.statusCode, 200)
})

test('в форме блока есть загрузка и показ состава', async () => {
  const id = await createBlock({
    pageId, type: 'merch', settings: defaultSettings('merch')
  })

  const body = (await app.inject({
    method: 'GET', url: `/admin/blocks/${id}`, cookies: auth.cookies
  })).body

  assert.match(body, /data-album-upload/)
  assert.match(body, /data-album-strip/)
  assert.match(body, /data-album-pick/, 'выбор из медиатеки')
  assert.match(body, /id="albumStrings"/)
  assert.match(body, /id="albumStepPhotos"/, 'второй шаг окна создания')
  // Панель одна и та же: под выбором и внутри окна.
  assert.equal((body.match(/data-album-panel/g) || []).length, 2)
})

/* ─── Название товара ────────────────────────────────────── */

/** Подпись из медиатеки одна на все альбомы — для товара не годится. */
test('название товара принадлежит альбому, а не файлу', async () => {
  const id = await photo(51)
  const album = await createGallery('merch')
  await setGalleryItems(album, [{ mediaId: id, title: 'Футболка PADALI', price: '2500 RSD' }])

  await createBlock({
    pageId, type: 'merch', isVisible: true,
    settings: { ...defaultSettings('merch'), gallery_id: album }
  })

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(body, /Футболка PADALI/)
  assert.match(body, /data-order-item="Футболка PADALI — 2500 RSD"/)
})

test('без названия берётся подпись файла, а без неё — только цена', async () => {
  const id = await photo(52)
  const album = await createGallery('merch')
  await setGalleryItems(album, [{ mediaId: id, price: '900 RSD' }])

  await createBlock({
    pageId, type: 'merch', isVisible: true,
    settings: { ...defaultSettings('merch'), gallery_id: album }
  })

  const body = (await app.inject({ method: 'GET', url: '/' })).body
  assert.match(body, /data-order-item="900 RSD"/, 'без висящего тире')
})

test('название сохраняется из формы альбома вместе с ценой', async () => {
  const id = await photo(53)
  const album = await createGallery('merch')
  await setGalleryItems(album, [id])

  await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}`,
    cookies: auth.cookies,
    ...form({
      _csrf: auth.csrf, slug: 'merch', items: String(id),
      [`title[m${id}]`]: 'Худи PADALI',
      [`price[m${id}]`]: '5500 RSD'
    })
  })

  const fields = (await itemFieldsForGalleries([album])).get(album)
  assert.equal(fields.get(id).title, 'Худи PADALI')
  assert.equal(fields.get(id).price, '5500 RSD')
})

test('дозагрузка не стирает название', async () => {
  const first = await photo(54)
  const second = await photo(55)
  const album = await createGallery('merch')
  await setGalleryItems(album, [{ mediaId: first, title: 'Кепка', price: '1500 RSD' }])

  await app.inject({
    method: 'POST',
    url: `/admin/galleries/${album}/items.json`,
    cookies: auth.cookies,
    payload: { _csrf: auth.csrf, media: [second] }
  })

  const fields = (await itemFieldsForGalleries([album])).get(album)
  assert.equal(fields.get(first).title, 'Кепка')
  assert.equal(fields.get(first).price, '1500 RSD')
})

test('в форме альбома есть поле названия', async () => {
  const id = await photo(56)
  const album = await createGallery('merch')
  await setGalleryItems(album, [id])

  const body = (await app.inject({
    method: 'GET', url: `/admin/galleries/${album}`, cookies: auth.cookies
  })).body

  assert.ok(body.includes(`name="title[m${id}]"`), 'поле названия')
  assert.ok(body.includes(`name="price[m${id}]"`), 'поле цены')
})

/* ─── Контакт покупателя ─────────────────────────────────── */

test('имя профиля вытаскивается из любой записи', () => {
  for (const input of ['@padali', 'padali', 'https://t.me/padali', 't.me/padali/',
    'https://www.instagram.com/padali/', 'instagram.com/padali?hl=sr']) {
    assert.equal(normalizeHandle(input), 'padali', input)
  }
})

test('форма записи проверяется по виду связи', () => {
  assert.equal(looksValid('email', 'fan@mail.rs'), true)
  assert.equal(looksValid('email', 'fan@mail'), false)
  assert.equal(looksValid('email', 'просто текст'), false)

  assert.equal(looksValid('telegram', '@padali_fan'), true)
  assert.equal(looksValid('telegram', '@ab'), false, 'короче пяти знаков')
  assert.equal(looksValid('telegram', '@фан'), false, 'кириллицы там не бывает')

  assert.equal(looksValid('instagram', 'padali.band'), true)
  assert.equal(looksValid('instagram', 'пад али'), false)
})

test('почта проверяется без обращения в сеть', async () => {
  let called = false
  const result = await checkContact('email', '  fan@mail.rs ', {
    fetchImpl: async () => { called = true }
  })

  assert.deepEqual(result, { ok: true, contact: 'fan@mail.rs' })
  assert.equal(called, false)
})

/** t.me отдаёт 200 и на выдуманное имя — отличает только карточка. */
test('телеграм проверяется по странице профиля', async () => {
  const page = (body) => async () => ({ ok: true, status: 200, text: async () => body })

  const real = await checkContact('telegram', '@durov', {
    fetchImpl: page('<div class="tgme_page_title">Pavel</div>')
  })
  assert.deepEqual(real, { ok: true, contact: 'Telegram: @durov' })

  const fake = await checkContact('telegram', '@nobody_here_1234', {
    fetchImpl: page('<div class="tgme_page_icon">Telegram</div>')
  })
  assert.deepEqual(fake, { ok: false, reason: 'missing' })
})

/** Потерять покупателя из-за моргнувшей сети хуже, чем принять опечатку. */
test('недоступный t.me не отказывает покупателю', async () => {
  const result = await checkContact('telegram', '@padali_fan', {
    fetchImpl: async () => { throw new Error('ETIMEDOUT') }
  })
  assert.equal(result.ok, true)
})

/**
 * Instagram на выдуманное имя отдаёт ту же оболочку, что и на
 * настоящее: проверено запросами к странице, к web_profile_info
 * и к ?__a=1. Поэтому только формат — и в сеть не ходим.
 */
test('инстаграм проверяется только формой записи', async () => {
  let called = false
  const good = await checkContact('instagram', '@padali.band', {
    fetchImpl: async () => { called = true }
  })
  assert.deepEqual(good, { ok: true, contact: 'Instagram: @padali.band' })
  assert.equal(called, false)

  const bad = await checkContact('instagram', 'пад али', { fetchImpl: async () => {} })
  assert.deepEqual(bad, { ok: false, reason: 'format' })
})

test('неизвестный вид связи отвергается', async () => {
  assert.deepEqual(await checkContact('whatsapp', '+381...'), { ok: false, reason: 'kind' })
})

test('проверка доступна с сайта и отвечает да/нет', async () => {
  const good = await app.inject({
    method: 'POST', url: '/check-contact', payload: { kind: 'email', value: 'fan@mail.rs' }
  })
  assert.deepEqual(good.json(), { ok: true })

  const bad = await app.inject({
    method: 'POST', url: '/check-contact', payload: { kind: 'email', value: 'не адрес' }
  })
  assert.deepEqual(bad.json(), { ok: false })
})

/** Проверке из браузера верить нельзя — заказ проверяется заново. */
test('заказ с негодным адресом не принимается', async () => {
  const response = await send({
    kind: 'order', city: 'Niš', contact_kind: 'email', contact: 'не адрес'
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().reason, 'contact')
  assert.equal((await listMessages()).length, 0)
})

test('в окне заказа есть выбор вида связи и выключенное поле', async () => {
  const album = await createGallery('merch')
  const id = await photo(61)
  await setGalleryItems(album, [{ mediaId: id, title: 'Футболка', price: '2500 RSD' }])
  await createBlock({
    pageId, type: 'merch', isVisible: true,
    settings: { ...defaultSettings('merch'), gallery_id: album }
  })

  const body = (await app.inject({ method: 'GET', url: '/' })).body

  assert.match(body, /name="contact_kind"/)
  assert.match(body, /value="telegram"/)
  assert.match(body, /value="instagram"/)
  assert.match(body, /data-contact-value/)
  assert.match(body, /disabled/, 'поле адреса ждёт выбора')
})

/** Ящик у группы общий — письмо на языке сайта, а не разработки. */
test('письмо приходит на английском', async () => {
  const sent = []
  await sendMessage(
    { kind: 'order', item: 'Футболка — 2500 RSD', city: 'Novi Sad',
      contact: 'Telegram: @fan', locale: 'sr', body: 'размер L' },
    {
      settings: { host: 'smtp.test', port: 587, from: 'a@b', to: 'c@d' },
      transporter: { sendMail: async (mail) => { sent.push(mail) } }
    }
  )

  const [mail] = sent
  assert.match(mail.subject, /^Merch order: Футболка — 2500 RSD$/)
  assert.match(mail.text, /^Item: /m)
  assert.match(mail.text, /^City: Novi Sad$/m)
  assert.match(mail.text, /^Contact: Telegram: @fan$/m)
  assert.match(mail.text, /^Page language: sr$/m)
  assert.match(mail.text, /размер L/, 'текст посетителя не трогаем')
  assert.doesNotMatch(mail.text, /Товар|Город|Связь/)
})

test('письмо из формы связи тоже на английском', async () => {
  const sent = []
  await sendMessage(
    { kind: 'contact', body: 'Позовите нас играть', contact: 'club@ns.rs' },
    {
      settings: { host: 'smtp.test', port: 587, from: 'a@b', to: 'c@d' },
      transporter: { sendMail: async (mail) => { sent.push(mail) } }
    }
  )

  assert.equal(sent[0].subject, 'Message from the site')
})
