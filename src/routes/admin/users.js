import {
  listUsers, getUser, findUserByEmail, createUser, updatePassword,
  setUserBlocked, deleteUser, countActiveUsers
} from '../../repositories/users.js'
import { deleteSessionsOfUser } from '../../repositories/sessions.js'
import { hashPassword, setFlash } from '../../services/auth.js'
import { renderAdmin, numericId } from './helpers.js'

/** Короткий пароль — самая частая дыра в маленьких админках. */
const MIN_PASSWORD = 10
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function userRoutes (app) {
  app.get('/users', async (request, reply) => {
    return renderAdmin(request, reply, 'admin/users', {
      users: await listUsers(),
      currentUserId: request.adminUser?.id ?? null,
      minPassword: MIN_PASSWORD
    })
  })

  app.post('/users', async (request, reply) => {
    const email = String(request.body?.email ?? '').trim().toLowerCase()
    const password = String(request.body?.password ?? '')

    if (!EMAIL.test(email)) {
      setFlash(reply, 'error', request.t('users.emailInvalid'))
      return reply.redirect('/admin/users', 302)
    }
    if (password.length < MIN_PASSWORD) {
      setFlash(reply, 'error', request.t('users.passwordShort', { min: MIN_PASSWORD }))
      return reply.redirect('/admin/users', 302)
    }
    if (await findUserByEmail(email)) {
      setFlash(reply, 'error', request.t('users.emailTaken', { email }))
      return reply.redirect('/admin/users', 302)
    }

    await createUser({ email, passwordHash: await hashPassword(password) })
    setFlash(reply, 'success', request.t('users.addedOk', { email }))
    return reply.redirect('/admin/users', 302)
  })

  app.post('/users/:id/block', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const user = await getUser(id)
    if (!user) return reply.callNotFound()

    const blocked = String(request.body?.blocked ?? '') === '1'

    // Себя блокировать нельзя — это мгновенная потеря доступа.
    if (blocked && id === request.adminUser?.id) {
      setFlash(reply, 'error', request.t('users.cannotBlockSelf'))
      return reply.redirect('/admin/users', 302)
    }
    // И нельзя оставить систему без единой рабочей учётки.
    if (blocked && !user.is_blocked && await countActiveUsers() <= 1) {
      setFlash(reply, 'error', request.t('users.lastActive'))
      return reply.redirect('/admin/users', 302)
    }

    await setUserBlocked(id, blocked)
    if (blocked) await deleteSessionsOfUser(id)

    setFlash(reply, 'success', request.t(blocked ? 'users.blockedOk' : 'users.unblockedOk', { email: user.email }))
    return reply.redirect('/admin/users', 302)
  })

  app.post('/users/:id/password', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const user = await getUser(id)
    if (!user) return reply.callNotFound()

    const password = String(request.body?.password ?? '')
    if (password.length < MIN_PASSWORD) {
      setFlash(reply, 'error', request.t('users.passwordShort', { min: MIN_PASSWORD }))
      return reply.redirect('/admin/users', 302)
    }

    await updatePassword(id, await hashPassword(password))
    // Чужие сессии после смены пароля закрываем, свою оставляем.
    if (id !== request.adminUser?.id) await deleteSessionsOfUser(id)

    setFlash(reply, 'success', request.t('users.passwordChanged', { email: user.email }))
    return reply.redirect('/admin/users', 302)
  })

  app.post('/users/:id/delete', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    const user = await getUser(id)
    if (!user) return reply.callNotFound()

    if (id === request.adminUser?.id) {
      setFlash(reply, 'error', request.t('users.cannotDeleteSelf'))
      return reply.redirect('/admin/users', 302)
    }
    if (!user.is_blocked && await countActiveUsers() <= 1) {
      setFlash(reply, 'error', request.t('users.lastActive'))
      return reply.redirect('/admin/users', 302)
    }

    await deleteUser(id)
    setFlash(reply, 'success', request.t('users.deletedOk', { email: user.email }))
    return reply.redirect('/admin/users', 302)
  })
}

export default userRoutes
export { MIN_PASSWORD }
