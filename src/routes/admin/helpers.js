import { render } from '../../services/renderer.js'
import { ensureCsrfToken, takeFlash } from '../../services/auth.js'
import { listLocales } from '../../repositories/locales.js'
import { invalidateCache } from '../../services/cache.js'

const NAV = [
  { href: '/admin', label: 'Блоки', match: /^\/admin\/?$|^\/admin\/blocks/ },
  { href: '/admin/galleries', label: 'Альбомы', match: /^\/admin\/galleries/ },
  { href: '/admin/media', label: 'Медиатека', match: /^\/admin\/media/ },
  { href: '/admin/settings', label: 'Настройки', match: /^\/admin\/settings/ }
]

/**
 * Общий контекст админских страниц: токен, пользователь, меню, сообщение.
 */
async function renderAdmin (request, reply, template, data = {}) {
  const locales = data.locales ?? await listLocales()
  const html = render(template, {
    ...data,
    locales,
    csrf: ensureCsrfToken(request, reply),
    user: request.adminUser ?? null,
    flash: takeFlash(request, reply),
    nav: NAV.map((item) => ({ ...item, active: item.match.test(request.url.split('?')[0]) })),
    currentPath: request.url
  })
  reply.type('text/html; charset=utf-8')
  return reply.send(html)
}

/** Любая запись делает кэш публичных страниц недействительным. */
function afterWrite () {
  invalidateCache()
}

export { renderAdmin, afterWrite, NAV }
