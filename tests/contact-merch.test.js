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
  createGallery, setGalleryItems, getGalleryItems, pricesForGalleries
} from '../src/repositories/galleries.js'
import { processUpload } from '../src/services/media-processor.js'
import { listMessages, countUnread } from '../src/repositories/messages.js'
import { defaultSettings } from '../src/blocks/index.js'
import { sendMessage, isMailConfigured } from '../src/services/mail.js'

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
    kind: 'order', city: 'Novi Sad', contact: '@padalifan',
    item: 'Футболка — 2500 RSD', message: 'размер L'
  })

  const [saved] = await listMessages()
  assert.equal(saved.kind, 'order')
  assert.equal(saved.city, 'Novi Sad')
  assert.equal(saved.contact, '@padalifan')
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
  assert.equal((await send({ kind: 'order', city: 'Niš', contact: '' })).statusCode, 400)
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

  const prices = (await pricesForGalleries([album])).get(album)
  assert.equal(prices.get(first), '2500 RSD')
  assert.equal(prices.get(second), '1200 RSD')
  assert.deepEqual(await getGalleryItems(album), [second, first], 'порядок — как прислали')
})

/** Старые вызовы передают голые id; ломать их нельзя. */
test('состав без цен сохраняется по-прежнему', async () => {
  const id = await photo(35)
  const album = await createGallery('plain')
  await setGalleryItems(album, [id])

  assert.deepEqual(await getGalleryItems(album), [id])
  assert.equal((await pricesForGalleries([album])).size, 0)
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

  const prices = (await pricesForGalleries([album])).get(album)
  assert.equal(prices.get(id), '2500 RSD')
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
