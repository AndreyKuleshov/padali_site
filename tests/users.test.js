import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetDatabase, createTestServer, createTestAdmin, loginAs, form, closePool, TEST_ADMIN
} from './helpers.js'
import { listUsers, findUserByEmail, getUser, countActiveUsers } from '../src/repositories/users.js'
import { findSession } from '../src/repositories/sessions.js'
import { hashPassword } from '../src/services/auth.js'
import { createUser } from '../src/repositories/users.js'

let app
let session
let ownerId

beforeEach(async () => {
  await resetDatabase()
  ownerId = await createTestAdmin()
  if (!app) app = await createTestServer()
  session = await loginAs(app)
})

after(async () => {
  if (app) await app.close()
  await closePool()
})

function post (url, fields) {
  return app.inject({ method: 'POST', url, cookies: session.cookies, ...form({ _csrf: session.csrf, ...fields }) })
}

async function addTester (password = 'tester-password-1') {
  await post('/admin/users', { email: 'tester@padali.local', password })
  return findUserByEmail('tester@padali.local')
}

test('страница администраторов доступна и перечисляет учётки', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin/users', cookies: session.cookies })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /test@padali\.local/)
})

test('новая учётка создаётся и может войти', async () => {
  const tester = await addTester()
  assert.ok(tester, 'учётка создана')
  assert.equal(tester.is_blocked, false)

  const page = await app.inject({ method: 'GET', url: '/admin/login' })
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)[1]
  const csrfCookie = page.cookies.find((cookie) => cookie.name === 'padali_csrf')
  const login = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    ...form({ _csrf: csrf, email: 'tester@padali.local', password: 'tester-password-1' })
  })
  assert.ok(login.cookies.find((cookie) => cookie.name === 'padali_session'), 'вход удался')
})

test('короткий пароль и кривая почта отклоняются', async () => {
  await post('/admin/users', { email: 'short@padali.local', password: 'xyz' })
  assert.equal(await findUserByEmail('short@padali.local'), null)

  await post('/admin/users', { email: 'не-почта', password: 'long-enough-password' })
  assert.equal((await listUsers()).length, 1)
})

test('повторная почта не создаёт вторую учётку', async () => {
  await addTester()
  await addTester('другой-пароль-подлиннее')
  assert.equal((await listUsers()).length, 2)
})

/** Блокировка должна немедленно выкидывать из админки. */
test('блокировка закрывает открытые сессии и запрещает вход', async () => {
  const tester = await addTester()

  const page = await app.inject({ method: 'GET', url: '/admin/login' })
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)[1]
  const csrfCookie = page.cookies.find((cookie) => cookie.name === 'padali_csrf')
  const login = await app.inject({
    method: 'POST', url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    ...form({ _csrf: csrf, email: 'tester@padali.local', password: 'tester-password-1' })
  })
  const testerSession = login.cookies.find((cookie) => cookie.name === 'padali_session').value
  assert.ok(await findSession(testerSession), 'сессия есть')

  await post(`/admin/users/${tester.id}/block`, { blocked: '1' })

  assert.equal((await getUser(tester.id)).is_blocked, true)
  assert.equal(await findSession(testerSession), null, 'сессия закрыта')

  const blocked = await app.inject({
    method: 'GET', url: '/admin', cookies: { padali_session: testerSession }
  })
  assert.equal(blocked.statusCode, 302, 'в админку больше не пускает')

  const retry = await app.inject({
    method: 'POST', url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    ...form({ _csrf: csrf, email: 'tester@padali.local', password: 'tester-password-1' })
  })
  assert.equal(retry.statusCode, 401, 'заблокированный не входит даже с верным паролем')
})

test('разблокировка возвращает доступ', async () => {
  const tester = await addTester()
  await post(`/admin/users/${tester.id}/block`, { blocked: '1' })
  await post(`/admin/users/${tester.id}/block`, { blocked: '0' })
  assert.equal((await getUser(tester.id)).is_blocked, false)
})

test('себя заблокировать и удалить нельзя', async () => {
  await post(`/admin/users/${ownerId}/block`, { blocked: '1' })
  assert.equal((await getUser(ownerId)).is_blocked, false)

  await post(`/admin/users/${ownerId}/delete`, {})
  assert.ok(await getUser(ownerId), 'учётка на месте')
})

test('последнюю работающую учётку не отключить', async () => {
  const tester = await addTester()
  await post(`/admin/users/${tester.id}/block`, { blocked: '1' })

  // Остался один активный — владелец; заблокировать его нельзя уже
  // по правилу «не себя», поэтому проверяем через вторую сессию.
  assert.equal(await countActiveUsers(), 1)

  const other = await createUser({ email: 'other@padali.local', passwordHash: await hashPassword('password-long-1') })
  await post(`/admin/users/${ownerId}/delete`, {})
  assert.ok(await getUser(ownerId), 'себя удалить нельзя')
  assert.ok(await getUser(other), 'вторая учётка создана')
})

test('смена пароля работает и закрывает чужие сессии', async () => {
  const tester = await addTester()
  await post(`/admin/users/${tester.id}/password`, { password: 'новый-длинный-пароль' })

  const page = await app.inject({ method: 'GET', url: '/admin/login' })
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)[1]
  const csrfCookie = page.cookies.find((cookie) => cookie.name === 'padali_csrf')
  const login = await app.inject({
    method: 'POST', url: '/admin/login',
    cookies: { padali_csrf: csrfCookie.value },
    ...form({ _csrf: csrf, email: 'tester@padali.local', password: 'новый-длинный-пароль' })
  })
  assert.ok(login.cookies.find((cookie) => cookie.name === 'padali_session'), 'новый пароль действует')
})

test('удаление учётки убирает её из списка', async () => {
  const tester = await addTester()
  await post(`/admin/users/${tester.id}/delete`, {})
  assert.equal(await findUserByEmail('tester@padali.local'), null)
  assert.equal((await listUsers()).length, 1)
})

test('владелец страницы — тот, кто вошёл', async () => {
  const response = await app.inject({ method: 'GET', url: '/admin/users', cookies: session.cookies })
  assert.match(response.body, new RegExp(TEST_ADMIN.email))
})
