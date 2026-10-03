import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, createTestServer, createTestAdmin, loginAs, closePool } from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, deleteBlock } from '../src/repositories/blocks.js'
import { defaultSettings } from '../src/blocks/index.js'
import { query } from '../src/db/pool.js'
import {
  recordView, recordClicks, viewTotals, viewsByDay, topPaths, topReferrers,
  clickPoints, topTargets, purgeOlderThan
} from '../src/repositories/analytics.js'
import { visitorHash, isBot, referrerHost, normalizePath, parseClicks } from '../src/services/analytics.js'
import { intensityStep, isoDay } from '../src/routes/admin/analytics.js'

let app
let session
let galleryBlock
let linksBlock

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
  // Клик ссылается на настоящий блок: связь в базе с внешним ключом.
  const pageId = await createPage({ slug: 'home' })
  galleryBlock = await createBlock({ pageId, type: 'gallery', settings: defaultSettings('gallery') })
  linksBlock = await createBlock({ pageId, type: 'links', settings: defaultSettings('links') })
  if (!app) app = await createTestServer()
  session = await loginAs(app)
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

function beacon (payload, userAgent = 'Mozilla/5.0 (Macintosh) Chrome/140') {
  return app.inject({
    method: 'POST',
    url: '/_a',
    payload,
    headers: { 'content-type': 'application/json', 'user-agent': userAgent }
  })
}

test('счётчик записывает просмотр и отвечает без тела', async () => {
  const response = await beacon({ type: 'view', path: '/', locale: 'en', referrer: 'https://instagram.com/x', w: 1440 })
  assert.equal(response.statusCode, 204)
  assert.equal(response.body, '')

  const [row] = await query('SELECT path, locale, referrer_host, is_mobile FROM analytics_views')
  assert.equal(row.path, '/')
  assert.equal(row.locale, 'en')
  assert.equal(row.referrer_host, 'instagram.com')
  assert.equal(row.is_mobile, false)
})

test('узкий экран помечается как телефон', async () => {
  await beacon({ type: 'view', path: '/sr', w: 390 })
  const [row] = await query('SELECT is_mobile FROM analytics_views')
  assert.equal(row.is_mobile, true)
})

/** Счётчик не должен превращаться в журнал визитов краулеров. */
test('боты не считаются', async () => {
  await beacon({ type: 'view', path: '/', w: 1200 }, 'Googlebot/2.1 (+http://www.google.com/bot.html)')
  await beacon({ type: 'view', path: '/', w: 1200 }, 'curl/8.4.0')
  const [{ total }] = await query('SELECT COUNT(*)::int AS total FROM analytics_views')
  assert.equal(total, 0)
})

test('админка и загрузки в статистику не попадают', async () => {
  await beacon({ type: 'view', path: '/admin/users', w: 1200 })
  await beacon({ type: 'view', path: '/uploads/2026/10/x.webp', w: 1200 })
  const [{ total }] = await query('SELECT COUNT(*)::int AS total FROM analytics_views')
  assert.equal(total, 0)
})

test('адрес посетителя не сохраняется, а хеш меняется каждый день', () => {
  const request = { ip: '203.0.113.7', headers: { 'user-agent': 'Chrome' } }
  const today = visitorHash(request, new Date('2026-10-03T10:00:00Z'))
  const sameDay = visitorHash(request, new Date('2026-10-03T23:00:00Z'))
  const nextDay = visitorHash(request, new Date('2026-10-04T01:00:00Z'))

  assert.equal(today, sameDay, 'в пределах суток посетитель один')
  assert.notEqual(today, nextDay, 'назавтра связать визиты нельзя')
  assert.doesNotMatch(today, /203\.0\.113\.7/)
  assert.match(today, /^[a-f0-9]{32}$/)
})

test('свой домен источником перехода не считается', () => {
  assert.equal(referrerHost('https://instagram.com/padali.band'), 'instagram.com')
  assert.equal(referrerHost('не ссылка'), null)
  assert.equal(referrerHost(null), null)
})

test('клики пишутся пачкой, мусор отбрасывается', async () => {
  await beacon({
    type: 'clicks',
    path: '/',
    clicks: [
      { b: String(galleryBlock), x: -340, y: 214, w: 1440, t: '→ #photos' },
      { b: String(galleryBlock), x: 99999, y: 100, w: 1440, t: 'вне страницы' },
      { x: 10, y: 20, w: 1440, t: 'без якоря' },
      { b: String(linksBlock), x: 120, y: 60, w: 390, t: 'фото' }
    ]
  })
  const rows = await query('SELECT x_offset, block_id FROM analytics_clicks ORDER BY id')
  assert.equal(rows.length, 2, 'клик вне страницы и клик без якоря отброшены')
  assert.deepEqual(rows.map((r) => r.x_offset), [-340, 120])
  assert.deepEqual(rows.map((r) => r.block_id), [galleryBlock, linksBlock])
})

/**
 * Координаты от окна браузера съезжали: высота шапки задана в
 * единицах экрана, колонка содержимого центрирована, и у посетителя
 * с другим окном та же кнопка оказывалась в другом месте.
 */
test('клик запоминает блок и смещение от его центра', async () => {
  await beacon({
    type: 'clicks',
    path: '/',
    clicks: [
      { b: String(galleryBlock), x: 372, y: 240, w: 2056, t: 'кнопка: Next' },
      { b: 'header', x: -600, y: 20, w: 2056, t: 'кнопка: SR' }
    ]
  })

  const rows = await query('SELECT block_id, anchor, x_offset, y_offset FROM analytics_clicks ORDER BY id')
  assert.deepEqual(rows.map((r) => r.block_id), [galleryBlock, null])
  assert.deepEqual(rows.map((r) => r.anchor), [null, 'header'],
    'шапка сайта блоком не является и опознаётся именем')
  assert.equal(rows[0].x_offset, 372, 'горизонталь — пиксели от центра блока')
  assert.equal(rows[0].y_offset, 240, 'вертикаль — пиксели от верха блока')
})

test('подложный якорь не сохраняется', async () => {
  await beacon({
    type: 'clicks',
    path: '/',
    clicks: [{ b: 'main; drop table', x: 10, y: 10, w: 1440, t: 'x' }]
  })
  const [{ total }] = await query('SELECT COUNT(*)::int AS total FROM analytics_clicks')
  assert.equal(total, 0)
})

/**
 * Ровно та ошибка, на которую пожаловались: клик по стрелке галереи
 * ложился ниже и левее. Смещение от центра не зависит от окна.
 */
test('одна и та же кнопка при разных окнах даёт одно смещение', async () => {
  await beacon({
    type: 'clicks',
    path: '/',
    clicks: [
      { b: String(galleryBlock), x: 372, y: 214, w: 2056, t: 'кнопка: Next' },
      { b: String(galleryBlock), x: 372, y: 214, w: 1440, t: 'кнопка: Next' }
    ]
  })
  const rows = await query('SELECT x_offset, y_offset, viewport FROM analytics_clicks ORDER BY id')
  assert.deepEqual(rows.map((r) => [r.x_offset, r.y_offset]), [[372, 214], [372, 214]])
  assert.deepEqual(rows.map((r) => r.viewport), [2056, 1440], 'ширина окна при этом сохраняется')
})

test('пачка кликов ограничена сверху', () => {
  const many = Array.from({ length: 200 }, () => ({ b: String(galleryBlock), x: 5, y: 10, w: 1000, t: 'x' }))
  assert.equal(parseClicks(many, '/').length, 80)
})

test('посещения по дням отдаются без пропусков', async () => {
  await recordView({ path: '/', locale: 'en', visitorHash: 'a'.repeat(32), referrerHost: null, viewport: 1440, isMobile: false })
  const days = await viewsByDay(7)
  assert.equal(days.length, 8, 'восемь точек: семь суток плюс сегодня')
  assert.ok(days.some((row) => row.views === 1))
  assert.ok(days.some((row) => row.views === 0), 'дни без визитов присутствуют нулями')
})

test('итоги считают просмотры, посетителей и долю телефонов', async () => {
  const visitor = 'b'.repeat(32)
  await recordView({ path: '/', locale: 'en', visitorHash: visitor, referrerHost: null, viewport: 1440, isMobile: false })
  await recordView({ path: '/sr', locale: 'sr', visitorHash: visitor, referrerHost: null, viewport: 390, isMobile: true })
  await recordView({ path: '/', locale: 'en', visitorHash: 'c'.repeat(32), referrerHost: 'vk.com', viewport: 390, isMobile: true })

  const totals = await viewTotals(30)
  assert.equal(totals.views, 3)
  assert.equal(totals.visitors, 2, 'два просмотра одного посетителя считаются одним')
  assert.equal(totals.mobile, 2)

  assert.deepEqual((await topPaths(30)).map((r) => r.path), ['/', '/sr'])
  assert.deepEqual((await topReferrers(30)).map((r) => r.referrer_host), ['vk.com'])
})

test('карта кликов фильтруется по странице и ширине экрана', async () => {
  await recordClicks([
    { path: '/', blockId: galleryBlock, xOffset: 0, yOffset: 100, viewport: 1440, target: 'настольный' },
    { path: '/', blockId: galleryBlock, xOffset: 0, yOffset: 200, viewport: 390, target: 'телефон' },
    { path: '/sr', blockId: galleryBlock, xOffset: 0, yOffset: 300, viewport: 1440, target: 'другая страница' }
  ])

  const desktop = await clickPoints({ path: '/', band: 'desktop', days: 30 })
  assert.deepEqual(desktop.map((p) => p.target), ['настольный'])

  const mobile = await clickPoints({ path: '/', band: 'mobile', days: 30 })
  assert.deepEqual(mobile.map((p) => p.target), ['телефон'])

  // Список целей фильтруется тем же экраном, что и карта: иначе
  // «clicks: 0» и непустой список рядом противоречили бы друг другу.
  const desktopTargets = await topTargets({ path: '/', band: 'desktop', days: 30 })
  assert.deepEqual(desktopTargets.map((t) => t.target), ['настольный'])

  const mobileTargets = await topTargets({ path: '/', band: 'mobile', days: 30 })
  assert.deepEqual(mobileTargets.map((t) => t.target), ['телефон'])
})

test('старые события удаляются', async () => {
  await recordView({ path: '/', locale: 'en', visitorHash: 'd'.repeat(32), referrerHost: null, viewport: 1440, isMobile: false })
  await query("UPDATE analytics_views SET viewed_at = now() - interval '400 days'")

  const removed = await purgeOlderThan(180)
  assert.equal(removed.views, 1)
  const [{ total }] = await query('SELECT COUNT(*)::int AS total FROM analytics_views')
  assert.equal(total, 0)
})

test('день форматируется по местному времени, а не в UTC', () => {
  // Полночь по местному времени в отрицательном поясе уехала бы
  // на вчера, если форматировать через toISOString().
  const local = new Date(2026, 9, 3, 0, 0, 0)
  assert.equal(isoDay(local), '2026-10-03')
  assert.equal(isoDay('2026-01-09'), '2026-01-09')
})

test('ступени насыщенности монотонны и не выходят за шкалу', () => {
  assert.equal(intensityStep(0, 10), 0)
  assert.equal(intensityStep(1, 10), 1)
  assert.equal(intensityStep(10, 10), 4)
  assert.ok(intensityStep(5, 10) <= intensityStep(8, 10))
})

test('страница статистики открывается и показывает числа', async () => {
  await recordView({ path: '/', locale: 'en', visitorHash: 'e'.repeat(32), referrerHost: null, viewport: 1440, isMobile: false })
  await recordClicks([{ path: '/', blockId: galleryBlock, xOffset: -200, yOffset: 400, viewport: 1440, target: '→ #photos' }])

  const response = await app.inject({ method: 'GET', url: '/admin/analytics', cookies: session.cookies })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Visits/)
  assert.match(response.body, /class="bar/)
  assert.match(response.body, /hourmap-cell/)
  assert.match(response.body, /id="heatmap"/)
  assert.match(response.body, /→ #photos/)
})

test('статистика закрыта для посторонних', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin/analytics' })
  assert.equal(response.statusCode, 302)
})

test('нормализация пути отбрасывает параметры и чужое', () => {
  assert.equal(normalizePath('/sr?utm_source=x#top'), '/sr')
  assert.equal(normalizePath('https://evil.example/'), null)
  assert.equal(normalizePath('/admin'), null)
  assert.equal(isBot('Mozilla/5.0 Chrome/140'), false)
})

/**
 * Клики привязаны к блоку: переставили блок — точки едут с ним,
 * удалили — исчезают вместе с ним, а не остаются мусором в счётчике.
 */
test('удаление блока уносит его клики', async () => {
  await recordClicks([
    { path: '/', blockId: galleryBlock, xOffset: 10, yOffset: 20, viewport: 1440, target: 'в галерее' },
    { path: '/', blockId: linksBlock, xOffset: 30, yOffset: 40, viewport: 1440, target: 'в ссылках' },
    { path: '/', anchor: 'header', xOffset: 0, yOffset: 10, viewport: 1440, target: 'в шапке сайта' }
  ])
  assert.equal((await query('SELECT id FROM analytics_clicks')).length, 3)

  await deleteBlock(galleryBlock)

  const left = await query('SELECT block_id, anchor, target FROM analytics_clicks ORDER BY id')
  assert.deepEqual(left.map((r) => r.target), ['в ссылках', 'в шапке сайта'],
    'ушли только клики удалённого блока')
})

test('перестановка блока клики сохраняет', async () => {
  await recordClicks([
    { path: '/', blockId: galleryBlock, xOffset: 10, yOffset: 20, viewport: 1440, target: 'в галерее' }
  ])
  await query('UPDATE blocks SET position = 99 WHERE id = ?', [galleryBlock])

  const points = await clickPoints({ path: '/', band: 'desktop', days: 30 })
  assert.equal(points.length, 1, 'клик остался')
  assert.equal(points[0].anchor, String(galleryBlock), 'и по-прежнему привязан к блоку')
})

test('клик по блоку, удалённому пока страница была открыта, не роняет пачку', async () => {
  const stale = await createBlock({
    pageId: (await query('SELECT id FROM pages LIMIT 1'))[0].id,
    type: 'richtext',
    settings: defaultSettings('richtext')
  })
  await deleteBlock(stale)

  const written = await recordClicks([
    { path: '/', blockId: stale, xOffset: 1, yOffset: 2, viewport: 1440, target: 'устарел' },
    { path: '/', blockId: galleryBlock, xOffset: 3, yOffset: 4, viewport: 1440, target: 'живой' }
  ])

  assert.equal(written, 1, 'записан только клик по существующему блоку')
  const rows = await query('SELECT target FROM analytics_clicks')
  assert.deepEqual(rows.map((r) => r.target), ['живой'])
})

test('карта получает единый якорь: номер блока или имя области', async () => {
  await recordClicks([
    { path: '/', blockId: galleryBlock, xOffset: 5, yOffset: 6, viewport: 1440, target: 'блок' },
    { path: '/', anchor: 'header', xOffset: 7, yOffset: 8, viewport: 1440, target: 'шапка' }
  ])
  const points = await clickPoints({ path: '/', band: 'desktop', days: 30 })
  assert.deepEqual(points.map((p) => p.anchor).sort(), [String(galleryBlock), 'header'].sort())
})
