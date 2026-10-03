import { login, logout, ensureCsrfToken, verifyCsrf, setFlash } from '../../services/auth.js'
import { render } from '../../services/renderer.js'
import { languageUrl } from './helpers.js'
import config from '../../config.js'

/** Страница входа рисуется вне общего каркаса — у неё нет меню. */
function renderLogin (request, reply, error) {
  return render('admin/login', {
    csrf: ensureCsrfToken(request, reply),
    error,
    t: request.t,
    adminLocale: request.adminLocale,
    languages: (request.adminLocales ?? []).map((code) => ({
      code,
      href: languageUrl(request.url, code),
      active: code === request.adminLocale
    }))
  })
}

async function authRoutes (app) {
  app.get('/login', async (request, reply) => {
    reply.type('text/html; charset=utf-8')
    return reply.send(renderLogin(request, reply, null))
  })

  app.post('/login', {
    config: { rateLimit: config.loginRateLimit }
  }, async (request, reply) => {
    if (!verifyCsrf(request)) {
      reply.code(403).type('text/html; charset=utf-8')
      return reply.send(renderLogin(request, reply, request.t('login.expired')))
    }

    const email = String(request.body?.email ?? '')
    const password = String(request.body?.password ?? '')
    const user = await login(reply, { email, password })

    if (!user) {
      request.log.warn({ email }, 'Неудачная попытка входа в админку')
      reply.code(401).type('text/html; charset=utf-8')
      return reply.send(renderLogin(request, reply, request.t('login.failed')))
    }

    setFlash(reply, 'success', request.t('login.welcome', { email: user.email }))
    return reply.redirect('/admin', 302)
  })

  app.post('/logout', async (request, reply) => {
    await logout(request, reply)
    return reply.redirect('/admin/login', 302)
  })
}

export default authRoutes
