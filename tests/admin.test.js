import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { listBlocks, getBlockTexts, getBlock } from '../src/repositories/blocks.js'
import { createGallery } from '../src/repositories/galleries.js'
import { setSetting } from '../src/repositories/settings.js'

let app
let session
let pageId

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  pageId = await createPage({ slug: 'home' })
  if (!app) app = await createTestServer()
  session = await loginAs(app)
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

test('без сессии админка отправляет на страницу входа', async () => {
  for (const url of ['/admin', '/admin/media', '/admin/galleries', '/admin/settings']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 302, url)
    assert.equal(response.headers.location, '/admin/login')
  }
})

/* Строку повторителя рисуют дважды: сохранённую и пустую внутрь
   <template>. Копии расходились, и добавленная строка отличалась
   от пришедшей с сервера — теперь обе из одного партиала. */
test('повторитель соцсетей показывает строку и шаблон для новой', async () => {
  await setSetting('social', [{ icon: 'telegram', label: 'Telegram', url: 'https://t.me/padali' }])

  const response = await app.inject({
    method: 'GET', url: '/admin/settings', cookies: session.cookies
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /name="social\[0\]\[url\]" value="https:\/\/t\.me\/padali"/)
  assert.match(response.body, /<option value="telegram" selected>/)
  assert.match(response.body, /name="social\[__INDEX__\]\[url\]"/, 'шаблон новой строки на месте')
})

test('неверный пароль не пускает', async () => {
  const page = await app.inject({ method: 'GET', url: '/admin/login' })
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)[1]
  const csrfCookie = page.cookies.find((cookie) => cookie.name === 'padali_csrf')

  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    ...form({ _csrf: csrf, email: 'test@padali.local', password: 'не тот пароль' })
  })

  assert.equal(response.statusCode, 401)
  assert.equal(response.cookies.find((cookie) => cookie.name === 'padali_session'), undefined)
})

test('POST без CSRF-токена отклоняется', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/blocks',
    cookies: session.cookies,
    ...form({ type: 'gallery' })
  })

  assert.equal(response.statusCode, 403)
  assert.equal((await listBlocks(pageId)).length, 0, 'блок не создан')
})

test('новый блок создаётся скрытым и с настройками по умолчанию', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/blocks',
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'gallery' })
  })

  assert.equal(response.statusCode, 302)
  const [block] = await listBlocks(pageId)
  assert.equal(block.type, 'gallery')
  assert.equal(block.isVisible, false, 'незаполненный блок не должен сразу уйти на сайт')
  assert.equal(block.settings.layout, 'grid')
  assert.equal(block.settings.columns, 3)
})

test('неизвестный тип блока не создаётся', async () => {
  await app.inject({
    method: 'POST',
    url: '/admin/blocks',
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'произвольный' })
  })
  assert.equal((await listBlocks(pageId)).length, 0)
})

test('сохранение блока пишет настройки и оба перевода', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks', cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'gallery' })
  })
  const [block] = await listBlocks(pageId)
  const galleryId = await createGallery('album')

  const response = await app.inject({
    method: 'POST',
    url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      is_visible: 'on',
      'text[en][heading]': 'Photos',
      'text[sr][heading]': 'Fotografije',
      'text[en][nav_label]': 'Photos',
      'settings[gallery_id]': String(galleryId),
      'settings[layout]': 'masonry',
      'settings[columns]': '4',
      'settings[lightbox]': 'on',
      'settings[limit]': '0'
    })
  })

  assert.equal(response.statusCode, 302)
  const saved = await getBlock(block.id)
  assert.equal(saved.isVisible, true)
  assert.equal(saved.anchor, 'photos', 'якорь выдан при создании и сохранение его не стирает')
  assert.equal(saved.settings.layout, 'masonry')
  assert.equal(saved.settings.columns, 4)
  assert.equal(saved.settings.show_captions, false)

  const texts = await getBlockTexts(block.id)
  assert.equal(texts.en.heading, 'Photos')
  assert.equal(texts.sr.heading, 'Fotografije')
})

test('блок с незаполненным обязательным полем нельзя включить', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks', cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'gallery' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST',
    url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    ...form({ _csrf: session.csrf, is_visible: 'on', 'settings[gallery_id]': '' })
  })

  const saved = await getBlock(block.id)
  assert.equal(saved.isVisible, false, 'альбом не выбран — блок остаётся скрытым')
})

test('порядок блоков сохраняется перетаскиванием', async () => {
  for (const type of ['hero', 'gallery', 'links']) {
    await app.inject({
      method: 'POST', url: '/admin/blocks', cookies: session.cookies,
      ...form({ _csrf: session.csrf, type })
    })
  }
  const before = await listBlocks(pageId)
  const reversed = before.map((block) => block.id).reverse()

  const response = await app.inject({
    method: 'POST',
    url: '/admin/blocks/reorder',
    cookies: session.cookies,
    payload: { _csrf: session.csrf, order: reversed }
  })

  assert.equal(response.statusCode, 200)
  const after = await listBlocks(pageId)
  assert.deepEqual(after.map((block) => block.id), reversed)
})

test('переключатель видимости работает', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks', cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'richtext' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}/toggle`,
    cookies: session.cookies, ...form({ _csrf: session.csrf })
  })
  assert.equal((await getBlock(block.id)).isVisible, true)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}/toggle`,
    cookies: session.cookies, ...form({ _csrf: session.csrf })
  })
  assert.equal((await getBlock(block.id)).isVisible, false)
})

test('удаление блока уносит его тексты', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks', cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'richtext' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}`, cookies: session.cookies,
    ...form({ _csrf: session.csrf, 'text[en][heading]': 'Пока', 'settings[width]': 'narrow' })
  })
  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}/delete`,
    cookies: session.cookies, ...form({ _csrf: session.csrf })
  })

  assert.equal(await getBlock(block.id), null)
  assert.deepEqual(await getBlockTexts(block.id), {})
})

/* Выход жил вне охраны: POST с чужой страницы разлогинивал
   редактора без токена. */
test('выход без CSRF-токена не разрывает сессию', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/logout', cookies: session.cookies, ...form({})
  })
  assert.equal(response.statusCode, 403)

  const after = await app.inject({ method: 'GET', url: '/admin', cookies: session.cookies })
  assert.equal(after.statusCode, 200, 'сессия на месте')
})

test('выход закрывает доступ', async () => {
  await app.inject({
    method: 'POST', url: '/admin/logout', cookies: session.cookies, ...form({ _csrf: session.csrf })
  })
  const response = await app.inject({ method: 'GET', url: '/admin', cookies: session.cookies })
  assert.equal(response.statusCode, 302)
})

/* ─── Границы входных данных ─────────────────────────────── */

/** `Number('abc')` даёт NaN, драйвер шлёт его строкой — было 500
 *  с текстом ошибки базы в теле ответа. */
test('нечисловой id в пути даёт 404, а не ошибку базы', async () => {
  for (const url of ['/admin/blocks/abc', '/admin/galleries/abc', '/admin/media/abc']) {
    const response = await app.inject({ method: 'GET', url, cookies: session.cookies })
    assert.equal(response.statusCode, 404, url)
    assert.doesNotMatch(response.body, /invalid input syntax|NaN/, 'внутренности базы наружу не уходят')
  }
})
