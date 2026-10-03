import { login, logout, ensureCsrfToken, verifyCsrf, setFlash } from '../../services/auth.js'
import { render } from '../../services/renderer.js'
import config from '../../config.js'

async function authRoutes (app) {
  app.get('/login', async (request, reply) => {
    reply.type('text/html; charset=utf-8')
    return reply.send(render('admin/login', {
      csrf: ensureCsrfToken(request, reply),
      error: null
    }))
  })

  app.post('/login', {
    config: { rateLimit: config.loginRateLimit }
  }, async (request, reply) => {
    if (!verifyCsrf(request)) {
      reply.code(403).type('text/html; charset=utf-8')
      return reply.send(render('admin/login', {
        csrf: ensureCsrfToken(request, reply),
        error: 'Сессия устарела. Попробуйте ещё раз.'
      }))
    }

    const email = String(request.body?.email ?? '')
    const password = String(request.body?.password ?? '')
    const user = await login(reply, { email, password })

    if (!user) {
      request.log.warn({ email }, 'Неудачная попытка входа в админку')
      reply.code(401).type('text/html; charset=utf-8')
      return reply.send(render('admin/login', {
        csrf: ensureCsrfToken(request, reply),
        error: 'Неверный адрес или пароль.'
      }))
    }

    setFlash(reply, 'success', `Здравствуйте, ${user.email}.`)
    return reply.redirect('/admin', 302)
  })

  app.post('/logout', async (request, reply) => {
    await logout(request, reply)
    return reply.redirect('/admin/login', 302)
  })
}

export default authRoutes
