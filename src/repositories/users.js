import { db } from './helpers.js'

async function countUsers (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM admin_users')
  return Number(row.total)
}

/** Сколько учёток реально могут войти — чтобы не остаться без доступа. */
async function countActiveUsers (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM admin_users WHERE NOT is_blocked')
  return Number(row.total)
}

async function listUsers (conn) {
  return db(conn).all(
    'SELECT id, email, is_blocked, created_at FROM admin_users ORDER BY created_at, id'
  )
}

async function setUserBlocked (id, blocked, conn) {
  await db(conn).run('UPDATE admin_users SET is_blocked = ? WHERE id = ?', [blocked, id])
}

async function deleteUser (id, conn) {
  await db(conn).run('DELETE FROM admin_users WHERE id = ?', [id])
}

async function findUserByEmail (email, conn) {
  return db(conn).one(
    'SELECT id, email, password_hash, is_blocked FROM admin_users WHERE email = ?',
    [email.trim().toLowerCase()]
  )
}

async function getUser (id, conn) {
  return db(conn).one('SELECT id, email, is_blocked FROM admin_users WHERE id = ?', [id])
}

async function createUser ({ email, passwordHash }, conn) {
  return db(conn).insert(
    'INSERT INTO admin_users (email, password_hash) VALUES (?, ?) RETURNING id',
    [email.trim().toLowerCase(), passwordHash]
  )
}

async function updatePassword (id, passwordHash, conn) {
  await db(conn).run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [passwordHash, id])
}

export {
  countUsers, countActiveUsers, listUsers, findUserByEmail, getUser,
  createUser, updatePassword, setUserBlocked, deleteUser
}
