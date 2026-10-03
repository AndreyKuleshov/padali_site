import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, createTestServer, createTestAdmin, loginAs, closePool } from './helpers.js'
import { query } from '../src/db/pool.js'
import {
  recordView, recordClicks, viewTotals, viewsByDay, topPaths, topReferrers,
  clickPoints, topTargets, purgeOlderThan
} from '../src/repositories/analytics.js'
import { visitorHash, isBot, referrerHost, normalizePath, parseClicks } from '../src/services/analytics.js'
import { intensityStep, isoDay } from '../src/routes/admin/analytics.js'

let app
let session

beforeEach(async () => {
  await resetDatabase()
  await createTestAdmin()
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
      { x: 0.25, y: 900, w: 1440, t: '→ #photos' },
      { x: 9, y: 100, w: 1440, t: 'вне страницы' },
      { x: 0.8, y: 1500, w: 390, t: 'фото' }
    ]
  })
  const rows = await query('SELECT x_ratio, viewport FROM analytics_clicks ORDER BY id')
  assert.equal(rows.length, 2, 'доля шире страницы не сохраняется')
  assert.deepEqual(rows.map((r) => r.x_ratio), [0.25, 0.8])
})

test('пачка кликов ограничена сверху', () => {
  const many = Array.from({ length: 200 }, () => ({ x: 0.5, y: 10, w: 1000, t: 'x' }))
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
    { path: '/', xRatio: 0.5, yOffset: 100, viewport: 1440, target: 'настольный' },
    { path: '/', xRatio: 0.5, yOffset: 200, viewport: 390, target: 'телефон' },
    { path: '/sr', xRatio: 0.5, yOffset: 300, viewport: 1440, target: 'другая страница' }
  ])

  const desktop = await clickPoints({ path: '/', band: 'desktop', days: 30 })
  assert.deepEqual(desktop.map((p) => p.target), ['настольный'])

  const mobile = await clickPoints({ path: '/', band: 'mobile', days: 30 })
  assert.deepEqual(mobile.map((p) => p.target), ['телефон'])

  const targets = await topTargets({ path: '/', days: 30 })
  assert.equal(targets.length, 2)
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
  await recordClicks([{ path: '/', xRatio: 0.3, yOffset: 400, viewport: 1440, target: '→ #photos' }])

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
