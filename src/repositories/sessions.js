import { db } from './helpers.js'

async function createSession ({ id, userId, expiresAt }, conn) {
  await db(conn).run(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    [id, userId, expiresAt]
  )
}

/** Возвращает сессию вместе с пользователем или null, если истекла. */
async function findSession (id, conn) {
  return db(conn).one(
    'SELECT s.id, s.user_id, s.expires_at, u.email ' +
    'FROM sessions s JOIN admin_users u ON u.id = s.user_id ' +
    'WHERE s.id = ? AND s.expires_at > now()',
    [id]
  )
}

async function deleteSession (id, conn) {
  await db(conn).run('DELETE FROM sessions WHERE id = ?', [id])
}

async function purgeExpiredSessions (conn) {
  const result = await db(conn).run('DELETE FROM sessions WHERE expires_at <= now()')
  return result.rowCount
}

export { createSession, findSession, deleteSession, purgeExpiredSessions }
