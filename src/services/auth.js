import { randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import config from '../config.js'
import { createSession, findSession, deleteSession } from '../repositories/sessions.js'
import { countUsers, createUser, findUserByEmail } from '../repositories/users.js'

const SESSION_COOKIE = 'padali_session'
const CSRF_COOKIE = 'padali_csrf'
const FLASH_COOKIE = 'padali_flash'

function baseCookieOptions () {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction
  }
}

function hashPassword (plain) {
  return argon2.hash(plain, { type: argon2.argon2id })
}

async function verifyPassword (hash, plain) {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

/**
 * Заводит учётки из окружения.
 *
 * ADMIN_EMAIL/ADMIN_PASSWORD — первый администратор, только когда
 * таблица пуста. ADMIN_USERS — список `почта:пароль`, каждая создаётся,
 * если такой почты ещё нет. Существующие записи не трогаются: пароль,
 * заданный в админке, переменная окружения не перезапишет.
 */
async function bootstrapAdminUser (logger = console) {
  let created = 0

  if (await countUsers() === 0) {
    if (config.bootstrapAdmin) {
      await createUser({
        email: config.bootstrapAdmin.email,
        passwordHash: await hashPassword(config.bootstrapAdmin.password)
      })
      logger.info?.(`Создан администратор ${config.bootstrapAdmin.email}.`)
      created += 1
    } else {
      logger.warn?.('Администраторов нет, а ADMIN_EMAIL/ADMIN_PASSWORD не заданы — в админку не войти.')
    }
  }

  for (const user of config.bootstrapUsers) {
    if (await findUserByEmail(user.email)) continue
    await createUser({ email: user.email, passwordHash: await hashPassword(user.password) })
    logger.info?.(`Создана учётка ${user.email} из ADMIN_USERS.`)
    created += 1
  }

  return created > 0
}

async function login (reply, { email, password }) {
  const user = await findUserByEmail(email)
  if (!user) return null
  // Проверяем пароль и у заблокированного: иначе по скорости ответа
  // можно было бы отличить заблокированную учётку от несуществующей.
  const passwordOk = await verifyPassword(user.password_hash, password)
  if (!passwordOk || user.is_blocked) return null

  const id = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + config.sessionTtlMs)
  await createSession({ id, userId: user.id, expiresAt })

  reply.setCookie(SESSION_COOKIE, id, { ...baseCookieOptions(), maxAge: config.sessionTtlMs / 1000 })
  return { id: user.id, email: user.email }
}

async function logout (request, reply) {
  const id = request.cookies?.[SESSION_COOKIE]
  if (id) await deleteSession(id)
  reply.clearCookie(SESSION_COOKIE, baseCookieOptions())
}

async function currentUser (request) {
  const id = request.cookies?.[SESSION_COOKIE]
  if (!id) return null
  const session = await findSession(id)
  return session ? { id: session.user_id, email: session.email } : null
}

/* ─── CSRF: двойная отправка токена ───────────────────────────
   Токен лежит в httpOnly-куке и в скрытом поле формы; совпадение
   проверяется побайтово. Чужой сайт куку прочитать не может,
   поэтому подделать поле ему нечем. */

function ensureCsrfToken (request, reply) {
  let token = request.cookies?.[CSRF_COOKIE]
  if (!token || token.length !== 64) {
    token = randomBytes(32).toString('hex')
    reply.setCookie(CSRF_COOKIE, token, baseCookieOptions())
  }
  return token
}

function verifyCsrf (request) {
  const fromCookie = request.cookies?.[CSRF_COOKIE]
  const fromBody = request.body?._csrf ?? request.headers['x-csrf-token']
  if (typeof fromCookie !== 'string' || typeof fromBody !== 'string') return false
  if (fromCookie.length !== fromBody.length) return false
  return timingSafeEqual(Buffer.from(fromCookie), Buffer.from(fromBody))
}

/* ─── Одноразовые сообщения ──────────────────────────────── */

function setFlash (reply, type, message) {
  reply.setCookie(
    FLASH_COOKIE,
    Buffer.from(JSON.stringify({ type, message }), 'utf8').toString('base64url'),
    { ...baseCookieOptions(), maxAge: 30 }
  )
}

function takeFlash (request, reply) {
  const raw = request.cookies?.[FLASH_COOKIE]
  if (!raw) return null
  reply.clearCookie(FLASH_COOKIE, baseCookieOptions())
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export {
  SESSION_COOKIE, CSRF_COOKIE,
  hashPassword, verifyPassword, bootstrapAdminUser,
  login, logout, currentUser,
  ensureCsrfToken, verifyCsrf,
  setFlash, takeFlash
}
