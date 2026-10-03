import { db } from './helpers.js'

function toView (row) {
  return {
    id: row.id,
    kind: row.kind,
    contact: row.contact,
    city: row.city,
    item: row.item,
    body: row.body,
    locale: row.locale,
    mailedAt: row.mailed_at,
    mailError: row.mail_error,
    isRead: row.is_read,
    createdAt: row.created_at
  }
}

async function createMessage (message, conn) {
  return db(conn).insert(
    'INSERT INTO messages (kind, contact, city, item, body, locale) ' +
    'VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [message.kind, message.contact ?? '', message.city ?? '',
      message.item ?? '', message.body ?? '', message.locale ?? null]
  )
}

/** Отметка об отправке: по списку должно быть видно, что не дошло. */
async function markMailed (id, error, conn) {
  /* Время считаем здесь, а не выражением в SQL: нетипизированный
     параметр внутри CASE Postgres разобрать не может («could not
     determine data type of parameter»), и запрос падал молча. */
  await db(conn).run(
    'UPDATE messages SET mailed_at = ?, mail_error = ? WHERE id = ?',
    [error ? null : new Date(), error ?? null, id]
  )
}

async function listMessages ({ limit = 100, offset = 0 } = {}, conn) {
  const rows = await db(conn).all(
    'SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [limit, offset]
  )
  return rows.map(toView)
}

async function countMessages (conn) {
  const row = await db(conn).one('SELECT COUNT(*)::int AS total FROM messages')
  return row?.total ?? 0
}

async function countUnread (conn) {
  const row = await db(conn).one('SELECT COUNT(*)::int AS total FROM messages WHERE NOT is_read')
  return row?.total ?? 0
}

async function markRead (id, isRead, conn) {
  await db(conn).run('UPDATE messages SET is_read = ? WHERE id = ?', [isRead, id])
}

async function deleteMessage (id, conn) {
  await db(conn).run('DELETE FROM messages WHERE id = ?', [id])
}

export {
  createMessage, markMailed, listMessages, countMessages, countUnread,
  markRead, deleteMessage
}
