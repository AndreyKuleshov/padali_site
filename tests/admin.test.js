import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { listBlocks, getBlockTexts, getBlock, saveBlockTexts } from '../src/repositories/blocks.js'
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

/* Печать экранирует кавычки: пустой data-album-id приезжал как
   значение из двух &quot;, панель принимала его за имя альбома и
   на каждой форме блока ходила за составом несуществующего. */
test('пустой id альбома в окне — действительно пустой', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'gallery' })
  })
  const [block] = await listBlocks(pageId)

  const response = await app.inject({
    method: 'GET', url: `/admin/blocks/${block.id}`, cookies: session.cookies
  })

  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /data-album-id=&(quot|#34);/, 'кавычки не экранированы в значение')
  assert.match(response.body, /data-album-id=""/, 'атрибут на месте и пуст')
})

/* «en» в toLocaleString — это американское 10/4/2026, где 4 —
   день. Рядом с сайтом, где всюду 16.10.2026, читается неверно. */
test('время письма показывается днём вперёд', async () => {
  const { formatDateTime } = await import('../src/services/renderer.js')
  const when = '2026-10-04T12:17:10Z'

  assert.match(formatDateTime(when, 'en'), /^04\/10\/2026/)
  assert.match(formatDateTime(when, 'sr'), /^4\.\s*10\.\s*2026/)
  assert.equal(formatDateTime(null, 'en'), '')
  assert.equal(formatDateTime('не дата', 'en'), 'не дата', 'мусор отдаём как есть')
})

/* Исключение для загрузки файлов делалось по типу тела, а не по
   адресу, и доставалось каждому POST админки: чужая форма с
   enctype=multipart проходила охрану без токена. Тело при этом
   никто не разбирал, разбор формы подставлял пустое — блок
   оставался без текстов, картинок и настроек. */
test('multipart не проносит запрос мимо проверки токена', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'gallery' })
  })
  const [block] = await listBlocks(pageId)
  await saveBlockTexts(block.id, { en: { heading: 'Было' } })

  const boundary = '----padali'
  const response = await app.inject({
    method: 'POST',
    url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}--\r\n`
  })

  assert.equal(response.statusCode, 403, 'без токена не проходит')
  assert.deepEqual(await getBlockTexts(block.id), { en: { heading: 'Было' } },
    'тексты на месте')
})

/* Концерт стал строкой повторителя: у каждого свои тексты на двух
   языках и своя афиша. Переводимое подполе уходит не в settings, а
   в тексты блока под ключом «events.<номер>.<поле>» — до этой
   правки шаблон рисовал его как settings[...], а разбор ждал
   text[...], и переводы молча пропадали. */
test('у каждого концерта свои тексты и своя афиша', async () => {
  const { processUpload } = await import('../src/services/media-processor.js')
  const { makeImage } = await import('./helpers.js')
  const { getBlockMedia } = await import('../src/repositories/blocks.js').then((m) => m)

  const first = (await processUpload({
    buffer: await makeImage({ width: 300, height: 400, seed: 95 }),
    originalName: 'afisha-1.png', mime: 'image/png'
  })).media
  const second = (await processUpload({
    buffer: await makeImage({ width: 300, height: 400, seed: 96 }),
    originalName: 'afisha-2.png', mime: 'image/png'
  })).media

  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'concert' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      is_visible: 'on',
      'text[en][heading]': 'Concerts',
      'settings[events][0][date]': '2026-10-16',
      'settings[events][0][tickets]': 'link',
      'text[en][events.0.venue]': 'Novi Sad',
      'text[sr][events.0.venue]': 'Novi Sad',
      'text[en][events.0.note]': 'С гостями',
      'media[events.0.poster][]': String(first.id),
      'settings[events][1][date]': '2026-11-20',
      'settings[events][1][tickets]': 'door',
      'text[en][events.1.venue]': 'Beograd',
      'media[events.1.poster][]': String(second.id)
    })
  })

  const saved = await getBlock(block.id)
  assert.equal(saved.settings.events.length, 2)
  assert.equal(saved.settings.events[1].tickets, 'door')

  const texts = await getBlockTexts(block.id)
  assert.equal(texts.en['events.0.venue'], 'Novi Sad')
  assert.equal(texts.sr['events.0.venue'], 'Novi Sad')
  assert.equal(texts.en['events.0.note'], 'С гостями')
  assert.equal(texts.en['events.1.venue'], 'Beograd')
  assert.equal(texts.en.heading, 'Concerts', 'заголовок остаётся у блока')

  const media = await getBlockMedia(block.id)
  assert.deepEqual(media['events.0.poster'], [first.id], 'афиша у своего концерта')
  assert.deepEqual(media['events.1.poster'], [second.id])

  /* И обратно: форма обязана рисовать ровно эти имена. Без этой
     проверки тест стерёг бы только разбор, а разметка могла
     вернуться к settings[...] — переводы бы молча пропадали. */
  const page = (await app.inject({
    method: 'GET', url: `/admin/blocks/${block.id}`, cookies: session.cookies
  })).body

  assert.match(page, /name="text\[en\]\[events\.0\.venue\]"/)
  assert.match(page, /name="text\[sr\]\[events\.0\.venue\]"/)
  assert.match(page, /name="media\[events\.1\.poster\]\[\]"/)
  assert.match(page, /name="settings\[events\]\[1\]\[price_currency\]"/,
    'у каждого концерта своя валюта, а не одна на всех')
  assert.doesNotMatch(page, /name="settings\[events\]\[0\]\[venue\]"/,
    'переводимое подполе не уходит в settings')
})

/* Ссылка на билеты нужна не всегда: при продаже на входе поле
   прячется. Условие объявлено в дескрипторе, а разметка обязана
   назвать управляющее поле ИМЕННО ЭТОЙ строки — иначе вторая
   вкладка слушала бы выбор первой. */
test('поле ссылки привязано к выбору своей строки', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'concert' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      is_visible: 'on',
      'settings[events][0][date]': '2026-10-16',
      'settings[events][0][tickets]': 'link',
      'settings[events][1][date]': '2026-11-20',
      'settings[events][1][tickets]': 'door'
    })
  })

  const page = (await app.inject({
    method: 'GET', url: `/admin/blocks/${block.id}`, cookies: session.cookies
  })).body

  const cells = [...page.matchAll(/data-show-if="([^"]*)" data-show-if-value="([^"]*)"/g)]
    .map(([, name, value]) => `${name}=${value}`)

  assert.deepEqual(cells, [
    // ссылка — только продаже по ссылке; подпись кнопки и цена — обоим способам
    'settings[events][0][tickets]=link',
    'settings[events][0][tickets]=link door',
    'settings[events][0][tickets]=link door',
    'settings[events][1][tickets]=link',
    'settings[events][1][tickets]=link door',
    'settings[events][1][tickets]=link door',
    'settings[events][__INDEX__][tickets]=link',
    'settings[events][__INDEX__][tickets]=link door',
    'settings[events][__INDEX__][tickets]=link door'
  ], 'каждая строка смотрит на свой выбор, и заготовка — тоже')

  /* Условие стоит на обёртке самого поля ссылки, а не где-то рядом:
     скрытие должно уносить и подпись. */
  assert.match(page, /<div class="repeater-cell" data-show-if="settings\[events\]\[1\]\[tickets\]"[^>]*>\s*<span class="cell-label">Ticket link<\/span>/)

  /* Кавычки в атрибутах — настоящие, а не &quot;: печать куска
     разметки через <%= уже ломала data-album-id. */
  assert.doesNotMatch(page, /data-show-if=&quot;/)

  /* Подпись кнопки сайт подставляет сам, и подсказка показывает
     чем — на каждом языке и для каждого способа продажи. Строки
     берутся из словаря сайта: вторая копия разъехалась бы с ним. */
  const { siteTranslator } = await import('../src/i18n/site.js')
  const hints = [...page.matchAll(/data-placeholders="([^"]*)"/g)]
    .map(([, json]) => JSON.parse(json.replaceAll('&quot;', '"')))

  assert.deepEqual(hints[0], {
    link: siteTranslator('en')('concert.tickets'),
    door: siteTranslator('en')('concert.atDoor')
  }, 'английскому полю — английские подписи')
  assert.deepEqual(hints[1], {
    link: siteTranslator('sr')('concert.tickets'),
    door: siteTranslator('sr')('concert.atDoor')
  }, 'сербскому — сербские')
  assert.notDeepEqual(hints[0], hints[1])

  assert.match(page, /data-placeholder-from="settings\[events\]\[1\]\[tickets\]"/,
    'подсказка смотрит на выбор своей строки')
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
  /* 1e20 — целое число, но в колонку INTEGER не влезает: Postgres
     отвечает «out of range», и выходила пятисотка вместо 404. */
  for (const url of [
    '/admin/blocks/abc', '/admin/galleries/abc', '/admin/media/abc',
    '/admin/blocks/99999999999999999999'
  ]) {
    const response = await app.inject({ method: 'GET', url, cookies: session.cookies })
    assert.equal(response.statusCode, 404, url)
    assert.doesNotMatch(response.body, /invalid input syntax|NaN/, 'внутренности базы наружу не уходят')
  }
})
