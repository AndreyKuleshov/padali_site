import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, closePool
} from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { listBlocks, getBlockTexts, getBlock, saveBlockTexts } from '../src/repositories/blocks.js'
import { createGallery } from '../src/repositories/galleries.js'
import { setSetting, getSetting } from '../src/repositories/settings.js'

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
  assert.match(response.body, /name="social\[r0\]\[url\]" value="https:\/\/t\.me\/padali"/)
  assert.match(response.body, /<option value="telegram" selected>/)
  assert.match(response.body, /name="social\[r__INDEX__\]\[url\]"/, 'шаблон новой строки на месте')
})

/* Соцсети разбирает не тот код, что строки блока, но имена полей
   у них общие. Переименование номера строки (с «[0]» на «[r0]»)
   легко забыть сверить со вторым читателем — отсюда эта проверка
   с удалённой средней строкой, какую и шлёт браузер. */
test('соцсети сохраняются и после удаления средней строки', async () => {
  const response = await app.inject({
    method: 'POST', url: '/admin/settings',
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      'social[r0][icon]': 'telegram',
      'social[r0][label]': 'Telegram',
      'social[r0][url]': 'https://t.me/padali',
      'social[r2][icon]': 'youtube',
      'social[r2][label]': 'YouTube',
      'social[r2][url]': 'https://youtube.com/@padali'
    })
  })

  assert.equal(response.statusCode, 302)

  const saved = await getSetting('social')
  assert.deepEqual(saved.map((row) => row.icon), ['telegram', 'youtube'],
    'обе строки на месте и в прежнем порядке')
  assert.equal(saved[1].url, 'https://youtube.com/@padali')
})

/* О новом письме узнавали, только зайдя в раздел. Теперь число
   непрочитанных стоит рядом с пунктом меню — на каждой странице
   админки, не только на самих сообщениях. */
test('непрочитанные показаны числом в меню и исчезают после «прочитать всё»', async () => {
  const { createMessage } = await import('../src/repositories/messages.js')
  await createMessage({ kind: 'contact', contact: 'a@b.rs', body: 'раз', locale: 'en' })
  await createMessage({ kind: 'contact', contact: 'c@d.rs', body: 'два', locale: 'en' })

  const badge = (body) => /<a href="\/admin\/messages"[^>]*>[^<]*<span class="nav-badge"[^>]*>(\d+)<\/span>/.exec(body)?.[1]

  /* Не только на странице сообщений: счётчик для того и нужен, чтобы
     увидеть его, занимаясь чем-то другим. */
  for (const url of ['/admin/', '/admin/media']) {
    const page = (await app.inject({ method: 'GET', url, cookies: session.cookies })).body
    assert.equal(badge(page), '2', url)
  }

  const marked = await app.inject({
    method: 'POST', url: '/admin/messages/read-all',
    cookies: session.cookies, ...form({ _csrf: session.csrf })
  })
  assert.equal(marked.statusCode, 302)

  const after = (await app.inject({ method: 'GET', url: '/admin/', cookies: session.cookies })).body
  assert.equal(badge(after), undefined, 'читать нечего — и значка нет')

  /* Кнопка тоже исчезает: вечно висящая и ничего не делающая учит
     не нажимать. */
  const page = (await app.inject({ method: 'GET', url: '/admin/messages', cookies: session.cookies })).body
  assert.doesNotMatch(page, /action="\/admin\/messages\/read-all"/)
})

/* Подтверждения удаления были окнами браузера: оформить их нельзя,
   выглядят чужими, а на телефоне показывают поверх вопроса адрес
   сайта. Разметка окна должна быть на каждой админской странице —
   без неё скрипт откатится к браузерному. */
test('окно подтверждения есть на страницах с удалением', async () => {
  for (const url of ['/admin/', '/admin/media', '/admin/users', '/admin/messages']) {
    const page = (await app.inject({ method: 'GET', url, cookies: session.cookies })).body
    assert.match(page, /<dialog class="confirm-dialog" id="confirmDialog"/, url)
    assert.match(page, /data-confirm-yes/, url + ': кнопки согласия нет')
    assert.match(page, /data-confirm-cancel/, url + ': кнопки отказа нет')
  }

  /* У блокировки учётки действие не «удалить», и подпись кнопки
     форма передаёт свою. */
  const users = (await app.inject({ method: 'GET', url: '/admin/users', cookies: session.cookies })).body
  assert.match(users, /data-confirm-action="Block"/)
  assert.doesNotMatch(users, /&quot;/, 'атрибуты не экранированы')
})

/* Та же ловушка, четвёртый раз: атрибут напечатан куском через
   <%=, кавычки экранировались, и в браузер приезжало
   class=&quot;active&quot; — текущий язык админки не подсвечивался
   вовсе, хотя в коде всё выглядело правильно. */
test('текущий язык админки помечен настоящим классом', async () => {
  /* Копий разметки было две — в шапке и на странице входа, — и
     правку в одной вторая пережила незамеченной. Проверяем обе. */
  const pages = [
    (await app.inject({ method: 'GET', url: '/admin/', cookies: session.cookies })).body,
    (await app.inject({ method: 'GET', url: '/admin/login' })).body
  ]

  for (const page of pages) {
    const nav = /<nav class="admin-lang[\s\S]*?<\/nav>/.exec(page)
    assert.ok(nav, 'переключателя языка нет')
    assert.doesNotMatch(nav[0], /&quot;/, 'кавычки в атрибуте настоящие')
    assert.equal((nav[0].match(/class="active"/g) || []).length, 1,
      'ровно один язык помечен текущим')
  }
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

/* Удалённая строка оставляет в форме дыру: браузер шлёт строки 0 и
   2. Сервер обязан сомкнуть ряд, иначе у оставшейся строки
   оказались бы чужие значения. Наступали дважды, и оба раза —
   на номере строки в имени поля: числовой ключ qs считает индексом
   массива, поэтому номер пишется с буквой.

   Раньше это проверялось на концертах — у них в строке были и
   тексты, и афиша. Концерты теперь приходят из Bandsintown, и
   строк у них нет; площадки лендинга — единственный оставшийся
   повторитель с тремя подполями. Тексты и афиши строки больше не
   объявляет ни один блок, и проверять на них нечего.*/
test('удаление строки повторителя из середины смыкает ряд', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'landing' })
  })
  const [block] = await listBlocks(pageId)

  await app.inject({
    method: 'POST', url: `/admin/blocks/${block.id}`,
    cookies: session.cookies,
    ...form({
      _csrf: session.csrf,
      is_visible: 'on',
      // средняя площадка удалена в браузере — строки 1 в форме нет
      'settings[platforms][r0][icon]': 'spotify',
      'settings[platforms][r0][label]': 'Остался первым',
      'settings[platforms][r0][url]': 'https://open.spotify.com/track/x',
      'settings[platforms][r2][icon]': 'tidal',
      'settings[platforms][r2][label]': 'Был третьим',
      'settings[platforms][r2][url]': 'https://tidal.com/track/z'
    })
  })

  const saved = await getBlock(block.id)
  assert.equal(saved.settings.platforms.length, 2, 'дыра сомкнулась')
  assert.equal(saved.settings.platforms[1].label, 'Был третьим', 'бывший третий встал вторым')
  assert.equal(saved.settings.platforms[1].icon, 'tidal', 'и значения приехали вместе с ним')
})

/* Концерты приходят из Bandsintown, и своих полей под события у
   блока нет: форма говорит об этом прямо и даёт ссылку туда, где
   правятся афиша и цена. Без этой подсказки пустая форма выглядит
   сломанной, и редактор идёт искать поля, которых нет. */
test('форма концертов объясняет, где теперь события', async () => {
  await app.inject({
    method: 'POST', url: '/admin/blocks',
    cookies: session.cookies, ...form({ _csrf: session.csrf, type: 'concert' })
  })
  const [block] = await listBlocks(pageId)

  const page = (await app.inject({
    method: 'GET', url: `/admin/blocks/${block.id}`, cookies: session.cookies
  })).body

  assert.match(page, /Bandsintown/, 'сказано, откуда берутся концерты')
  assert.match(page, /href="\/admin\/concerts"/, 'и куда идти за афишей и ценой')
  assert.doesNotMatch(page, /name="settings\[events\]/, 'полей под события у формы нет')
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

/* ─── Страницы ──────────────────────────────────────────────
   Слаг — это адрес, а не название: он уезжает в ссылку, в письмо
   и в питч. Поэтому проверяем его на входе и держим скучным. */
test('страница заводится, переименовывается и удаляется', async () => {
  const { listPages, getPageBySlug } = await import('../src/repositories/pages.js')

  const created = await app.inject({
    method: 'POST', url: '/admin/pages', cookies: session.cookies,
    ...form({ _csrf: session.csrf, slug: 'pocetak' })
  })
  assert.equal(created.statusCode, 302)

  const page = await getPageBySlug('pocetak')
  assert.ok(page, 'страница появилась')
  assert.equal(page.is_published, false,
    'новая не публикуется сразу: наполнять её ещё нечем, а пустой адрес в карте сайта — приглашение на страницу ни с чем')

  await app.inject({
    method: 'POST', url: `/admin/pages/${page.id}`, cookies: session.cookies,
    ...form({ _csrf: session.csrf, slug: 'pocetak-2026', is_published: '1' })
  })
  const renamed = await getPageBySlug('pocetak-2026')
  assert.ok(renamed, 'адрес сменился')
  assert.equal(renamed.is_published, true)

  await app.inject({
    method: 'POST', url: `/admin/pages/${page.id}/delete`, cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })
  assert.equal(await getPageBySlug('pocetak-2026'), null, 'страница удалена')
  assert.ok((await listPages()).some((row) => row.slug === 'home'), 'главная на месте')
})

/* Адрес из одного отрезка разбирается сперва как язык. Страница
   с именем языка была бы недостижима — её перехватил бы
   переключатель, и редактор чинил бы «пропавшую страницу»,
   которой некуда было деться. Поэтому запрещаем на входе. */
test('адрес страницы проверяется: мусор, занятое и имена языков', async () => {
  const { listPages } = await import('../src/repositories/pages.js')

  /* Судим по числу страниц, а не по поиску слага: «home» и так
     есть, и поиск сказал бы «создалась», ничего не создав. */
  async function created (slug) {
    const before = (await listPages()).length
    await app.inject({
      method: 'POST', url: '/admin/pages', cookies: session.cookies,
      ...form({ _csrf: session.csrf, slug })
    })
    return (await listPages()).length > before
  }

  assert.equal(await created('Нет Кириллицы'), false, 'кириллица и пробелы не проходят')
  assert.equal(await created('two words'), false, 'пробел не проходит')
  assert.equal(await created('-dash-first'), false, 'дефис по краям не проходит')
  assert.equal(await created('sr'), false, 'имя языка занято переключателем')
  assert.equal(await created('admin'), false, 'служебный адрес занят')
  assert.equal(await created('home'), false, 'главная живёт в корне')

  assert.equal(await created('pocetak'), true, 'нормальный адрес проходит')
  assert.equal(await created('pocetak'), false, 'повтор не создаёт второй страницы')
})

/* Главная живёт в корне: адреса у неё нет, и без неё сайт
   перестаёт существовать — корень отдаёт 404. */
test('главную нельзя удалить', async () => {
  const { getPageBySlug } = await import('../src/repositories/pages.js')
  const home = await getPageBySlug('home')

  const response = await app.inject({
    method: 'POST', url: `/admin/pages/${home.id}/delete`, cookies: session.cookies,
    ...form({ _csrf: session.csrf })
  })
  assert.equal(response.statusCode, 302)
  assert.ok(await getPageBySlug('home'), 'главная на месте')
})

/* Один и тот же список блоков обслуживает все страницы, и блок
   обязан лечь на ту, с которой его завели. */
test('блок заводится на выбранной странице, а не всегда на главной', async () => {
  const { createPage: makePage } = await import('../src/repositories/pages.js')
  const landing = await makePage({ slug: 'pocetak', isPublished: false })

  /* Правка страницы — один экран: адрес, заголовок и блоки. Три
     перехода до добавления блока были тремя поводами передумать. */
  const screen = await app.inject({ method: 'GET', url: `/admin/pages/${landing}`, cookies: session.cookies })
  assert.equal(screen.statusCode, 200)
  assert.match(screen.body, /name="slug"/, 'адрес правится здесь же')
  assert.match(screen.body, /name="text\[en\]\[title\]"/, 'и заголовок страницы')
  assert.match(screen.body, /id="blockList"|class="empty"/, 'и блоки здесь же')

  // Прежний адрес списка блоков уводит на этот экран, а не в 404.
  const old = await app.inject({ method: 'GET', url: `/admin/pages/${landing}/blocks`, cookies: session.cookies })
  assert.equal(old.statusCode, 301)

  await app.inject({
    method: 'POST', url: '/admin/blocks', cookies: session.cookies,
    ...form({ _csrf: session.csrf, type: 'richtext', page_id: landing })
  })

  assert.equal((await listBlocks(landing)).length, 1, 'блок лёг на лендинг')
  assert.equal((await listBlocks(pageId)).length, 0, 'на главную не попал')
})
