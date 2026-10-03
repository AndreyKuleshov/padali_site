import { rm, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import config from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { query, closePool } from '../src/db/pool.js'
import { buildServer } from '../src/server.js'
import { hashPassword } from '../src/services/auth.js'
import { createUser } from '../src/repositories/users.js'
import { invalidateCache } from '../src/services/cache.js'

const TABLES = [
  'block_media', 'block_texts', 'blocks',
  'gallery_items', 'gallery_texts', 'galleries',
  'media_texts', 'media',
  'page_texts', 'pages',
  'sessions', 'admin_users',
  'settings', 'locales'
]

/** Чистая база и чистый каталог загрузок перед каждым тестом. */
async function resetDatabase () {
  await migrate({ logger: { info () {}, warn () {} } })
  await query('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of TABLES) await query(`TRUNCATE TABLE \`${table}\``)
  await query('SET FOREIGN_KEY_CHECKS = 1')

  await query("INSERT INTO locales (code, title, is_default, position) VALUES ('en', 'English', 1, 0)")
  await query("INSERT INTO locales (code, title, is_default, position) VALUES ('sr', 'Srpski', 0, 1)")

  await rm(config.uploadDir, { recursive: true, force: true })
  await mkdir(config.uploadDir, { recursive: true })
  invalidateCache()
}

async function createTestServer () {
  const app = await buildServer({ logger: false })
  await app.ready()
  return app
}

const TEST_ADMIN = { email: 'test@padali.local', password: 'test-password-123' }

async function createTestAdmin () {
  return createUser({
    email: TEST_ADMIN.email,
    passwordHash: await hashPassword(TEST_ADMIN.password)
  })
}

/** Куки и CSRF-токен авторизованного администратора. */
async function loginAs (app) {
  const page = await app.inject({ method: 'GET', url: '/admin/login' })
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)[1]
  const csrfCookie = page.cookies.find((cookie) => cookie.name === 'padali_csrf')

  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    payload: new URLSearchParams({ _csrf: csrf, ...TEST_ADMIN }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })

  const session = response.cookies.find((cookie) => cookie.name === 'padali_session')
  if (!session) {
    throw new Error(`Не удалось войти в админку: код ${response.statusCode}. ` +
      'Проверьте LOGIN_RATE_LIMIT_MAX в .env.test.')
  }
  return {
    csrf,
    cookies: { padali_csrf: csrfCookie.value, padali_session: session?.value }
  }
}

/** Форма в теле запроса: URLSearchParams понимает повторяющиеся ключи. */
function form (fields) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else if (value !== undefined && value !== null) params.append(key, String(value))
  }
  return { payload: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

/** Картинка заданного размера, уникальная по содержимому. */
async function makeImage ({ width = 800, height = 600, seed = 1 } = {}) {
  return sharp({
    create: {
      width, height, channels: 3,
      background: { r: seed % 255, g: (seed * 7) % 255, b: (seed * 13) % 255 }
    }
  }).png().toBuffer()
}

export {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, makeImage,
  closePool, TEST_ADMIN
}
