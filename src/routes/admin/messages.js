import {
  listMessages, countMessages, countUnread, markRead, deleteMessage
} from '../../repositories/messages.js'
import { isMailConfigured } from '../../services/mail.js'
import { setFlash } from '../../services/auth.js'
import { renderAdmin, numericId, pageSlice } from './helpers.js'

const PER_PAGE = 50

async function messageRoutes (app) {
  app.get('/messages', async (request, reply) => {
    const slice = pageSlice(request, PER_PAGE)
    const [items, total, unread] = await Promise.all([
      listMessages(slice.range),
      countMessages(),
      countUnread()
    ])

    return renderAdmin(request, reply, 'admin/messages', {
      items,
      unread,
      ...slice.pager(total),
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
