import {
  listMessages, countMessages, countUnread, markRead, deleteMessage
} from '../../repositories/messages.js'
import { isMailConfigured } from '../../services/mail.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, numericId } from './helpers.js'

const PER_PAGE = 50

async function messageRoutes (app) {
  app.get('/messages', async (request, reply) => {
    const pageNumber = Math.max(Number.parseInt(request.query?.page ?? '1', 10) || 1, 1)
    const [items, total, unread] = await Promise.all([
      listMessages({ limit: PER_PAGE, offset: (pageNumber - 1) * PER_PAGE }),
      countMessages(),
      countUnread()
    ])

    return renderAdmin(request, reply, 'admin/messages', {
      items,
      total,
      unread,
      pageNumber,
      pageCount: Math.max(Math.ceil(total / PER_PAGE), 1),
      // Почта не настроена — сообщения всё равно здесь, но об этом
      // надо сказать: иначе ждут письма, которого не будет.
      mailConfigured: isMailConfigured()
    })
  })

  app.post('/messages/:id/read', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()
    await markRead(id, String(request.body?.read ?? '') === 'on')
    return reply.redirect('/admin/messages', 302)
  })

  app.post('/messages/:id/delete', async (request, reply) => {
    const id = numericId(request)
    if (id === null) return reply.callNotFound()

    await deleteMessage(id)
    setFlash(reply, 'success', request.t('messages.deleted'))
    return reply.redirect('/admin/messages', 302)
  })
}

export default messageRoutes
