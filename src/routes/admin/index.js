import { currentUser, verifyCsrf } from '../../services/auth.js'
import { resolveAdminLocale } from './helpers.js'
import authRoutes from './auth.js'
import blockRoutes from './blocks.js'
import mediaRoutes from './media.js'
import galleryRoutes from './galleries.js'
import settingsRoutes from './settings.js'
import userRoutes from './users.js'
import analyticsRoutes from './analytics.js'
import translateRoutes from './translate.js'

/**
 * Охрана админки: сессия обязательна, POST обязан нести CSRF-токен.
 * Исключение — multipart: тело на этом этапе ещё не разобрано,
 * токен проверяется внутри обработчика загрузки.
 */
async function guard (request, reply) {
  const user = await currentUser(request)
  if (!user) {
    return reply.redirect('/admin/login', 302)
  }
  request.adminUser = user

  if (request.method !== 'POST') return
  if (String(request.headers['content-type'] ?? '').startsWith('multipart/form-data')) return

  if (!verifyCsrf(request)) {
    request.log.warn({ url: request.url }, 'Запрос без действительного CSRF-токена')
    return reply.code(403).type('text/plain; charset=utf-8')
      .send(request.t('common.csrfExpired'))
  }
}

async function adminRoutes (app) {
  // Язык нужен и странице входа, поэтому хук стоит выше охраны.
  app.addHook('onRequest', resolveAdminLocale)

  await app.register(authRoutes)

  await app.register(async (scope) => {
    scope.addHook('preHandler', guard)
    await scope.register(blockRoutes)
    await scope.register(mediaRoutes)
    await scope.register(galleryRoutes)
    await scope.register(settingsRoutes)
    await scope.register(userRoutes)
    await scope.register(analyticsRoutes)
    await scope.register(translateRoutes)
  })
}

export default adminRoutes
