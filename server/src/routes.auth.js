import { Router } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { pool } from './db.js'

const router = Router()

function createToken(user) {
  const payload = { sub: user.id, username: user.username }
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' })
}

function generateRefreshToken() {
  const buf = crypto.randomBytes(32)
  const token = buf.toString('base64url')
  const hash = crypto.createHash('sha256').update(token).digest()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  return { token, hash, expiresAt }
}

async function persistRefreshToken(db, userId, hash, expiresAt) {
  await db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)', [userId, hash, expiresAt])
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('token', accessToken, { httpOnly: true, sameSite: 'lax' })
  // scope refresh cookie to refresh endpoint path for least exposure
  res.cookie('refresh', refreshToken, { httpOnly: true, sameSite: 'lax', path: '/api/auth/refresh' })
}

async function rotateRefresh(db, oldToken) {
  if (!oldToken) return null
  const oldHash = crypto.createHash('sha256').update(oldToken).digest()
  const [rows] = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()', [oldHash])
  if (rows.length === 0) return null
  // revoke old
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [oldHash])
  const { token, hash, expiresAt } = generateRefreshToken()
  await db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)', [rows[0].user_id, hash, expiresAt])
  return { userId: rows[0].user_id, token }
}

router.post('/register', async (req, res) => {
  const { username } = req.body
  if (!username || /\s/.test(username) || username.length > 32) {
    return res.status(400).json({ error: 'invalid_username' })
  }
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE username = ?', [username])
    if (rows.length > 0) return res.status(409).json({ error: 'username_taken' })
    const [result] = await db.query('INSERT INTO users (username) VALUES (?)', [username])
    const user = { id: result.insertId, username }
    const access = createToken(user)
    const { token: refresh, hash, expiresAt } = generateRefreshToken()
    await persistRefreshToken(db, user.id, hash, expiresAt)
    setAuthCookies(res, access, refresh)
    res.json({ user, token: access })
  } finally {
    db.release()
  }
})

router.post('/login', async (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'invalid_username' })
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT id, username, profile_pic FROM users WHERE username = ?', [username])
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' })
    const user = rows[0]
    const access = createToken(user)
    const { token: refresh, hash, expiresAt } = generateRefreshToken()
    await persistRefreshToken(db, user.id, hash, expiresAt)
    setAuthCookies(res, access, refresh)
    res.json({ user, token: access })
  } finally {
    db.release()
  }
})

router.post('/logout', async (req, res) => {
  const refresh = req.cookies?.refresh
  if (refresh) {
    try {
      const db = await pool.getConnection()
      try {
        const h = crypto.createHash('sha256').update(refresh).digest()
        await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [h])
      } finally { db.release() }
    } catch {}
  }
  res.clearCookie('token')
  res.clearCookie('refresh', { path: '/api/auth/refresh' })
  res.json({ ok: true })
})

router.get('/me', async (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
    const db = await pool.getConnection()
    try {
      const [rows] = await db.query('SELECT id, username, profile_pic FROM users WHERE id = ?', [payload.sub])
      if (!rows.length) return res.status(401).json({ error: 'unauthorized' })
      res.json({ user: rows[0] })
    } finally { db.release() }
  } catch {
    res.status(401).json({ error: 'unauthorized' })
  }
})

// rotate refresh token and issue new access token
router.post('/refresh', async (req, res) => {
  const refresh = req.cookies?.refresh
  if (!refresh) return res.status(401).json({ error: 'unauthorized' })
  const db = await pool.getConnection()
  try {
    const rotated = await rotateRefresh(db, refresh)
    if (!rotated) return res.status(401).json({ error: 'unauthorized' })
    const [rows] = await db.query('SELECT id, username FROM users WHERE id = ?', [rotated.userId])
    if (!rows.length) return res.status(401).json({ error: 'unauthorized' })
    const user = rows[0]
    const access = createToken(user)
    setAuthCookies(res, access, rotated.token)
    res.json({ token: access, user })
  } finally { db.release() }
})

export default router

