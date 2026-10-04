import { currentUser, verifyCsrf } from '../../services/auth.js'
import { resolveAdminLocale } from './helpers.js'
import authRoutes, { sessionRoutes } from './auth.js'
import blockRoutes from './blocks.js'
import mediaRoutes from './media.js'
import galleryRoutes from './galleries.js'
import settingsRoutes from './settings.js'
import userRoutes from './users.js'
import analyticsRoutes from './analytics.js'
import translateRoutes from './translate.js'
import messageRoutes from './messages.js'

/*
 * Загрузка файлов — единственное, что проверяет токен само: тело там
 * поток частей, и до токена надо дочитать. Список адресов, а не тип
 * тела.
 *
 * Пока исключение делалось по заголовку, его получал КАЖДЫЙ POST
 * админки: достаточно было поставить чужой форме multipart. Тело у
 * остальных маршрутов никто не разбирает, оно остаётся пустым, и
 * разбор формы подставляет пустое — один запрос без токена стирал
 * у блока тексты, картинки и настройки.
 */
const SELF_CHECKED = new Set(['/admin/media/upload', '/admin/media/upload.json'])

/**
 * Охрана админки: сессия обязательна, POST обязан нести CSRF-токен.
 */
async function guard (request, reply) {
  const user = await currentUser(request)
  if (!user) {
    return reply.redirect('/admin/login', 302)
  }
  request.adminUser = user

  if (request.method !== 'POST') return
  if (SELF_CHECKED.has(request.url.split('?')[0])) return

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
    await scope.register(sessionRoutes)
    await scope.register(blockRoutes)
    await scope.register(mediaRoutes)
    await scope.register(galleryRoutes)
    await scope.register(settingsRoutes)
    await scope.register(userRoutes)
    await scope.register(analyticsRoutes)
    await scope.register(translateRoutes)
    await scope.register(messageRoutes)
  })
}

export default adminRoutes
