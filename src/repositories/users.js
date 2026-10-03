import { db } from './helpers.js'

async function countUsers (conn) {
  const row = await db(conn).one('SELECT COUNT(*) AS total FROM admin_users')
  return Number(row.total)
}

async function findUserByEmail (email, conn) {
  return db(conn).one(
    'SELECT id, email, password_hash FROM admin_users WHERE email = ?',
    [email.trim().toLowerCase()]
  )
}

async function getUser (id, conn) {
  return db(conn).one('SELECT id, email FROM admin_users WHERE id = ?', [id])
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

export { countUsers, findUserByEmail, getUser, createUser, updatePassword }
