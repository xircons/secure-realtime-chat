import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { pool, getRedis } from './db.js'
import { encryptMessage, decryptMessage } from './crypto.js'
import { getOnlineUserIds, getIO } from './socket.js'

const router = Router()

function auth(req, res, next) {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
    req.user = { id: payload.sub, username: payload.username }
    next()
  } catch {
    res.status(401).json({ error: 'unauthorized' })
  }
}

// send chat request
router.post('/request', auth, async (req, res) => {
  const { toUsername } = req.body
  const db = await pool.getConnection()
  try {
    const [users] = await db.query('SELECT id FROM users WHERE username = ?', [toUsername])
    if (users.length === 0) return res.status(404).json({ error: 'recipient_not_found' })
    const recipientId = users[0].id
    if (recipientId === req.user.id) return res.status(400).json({ error: 'cannot_self_request' })
    const [existing] = await db.query('SELECT id, status FROM chat_requests WHERE sender_id = ? AND recipient_id = ? AND status = "pending"', [req.user.id, recipientId])
    if (existing.length) return res.json({ requestId: existing[0].id, status: existing[0].status })
    const [result] = await db.query('INSERT INTO chat_requests (sender_id, recipient_id) VALUES (?,?)', [req.user.id, recipientId])
    // notify interested clients to refresh requests
    try { getIO()?.emit('request:update', { requestId: result.insertId }) } catch {}
    res.json({ requestId: result.insertId, status: 'pending' })
  } finally {
    db.release()
  }
})

// list chat requests
router.get('/requests', auth, async (req, res) => {
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query(
      `SELECT cr.id, cr.status, u1.username AS sender, u2.username AS recipient
       FROM chat_requests cr
       JOIN users u1 ON u1.id = cr.sender_id
       JOIN users u2 ON u2.id = cr.recipient_id
       WHERE cr.sender_id = ? OR cr.recipient_id = ?
       ORDER BY cr.created_at DESC`,
      [req.user.id, req.user.id]
    )
    res.json({ requests: rows })
  } finally {
    db.release()
  }
})

// accept/decline chat request
router.post('/request/:id/respond', auth, async (req, res) => {
  const { action } = req.body // 'accept' | 'decline'
  const id = Number(req.params.id)
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT * FROM chat_requests WHERE id = ?', [id])
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' })
    const cr = rows[0]
    if (cr.recipient_id !== req.user.id) return res.status(403).json({ error: 'forbidden' })
    const status = action === 'accept' ? 'accepted' : 'declined'
    await db.query('UPDATE chat_requests SET status = ? WHERE id = ?', [status, id])
    let sessionId = null
    if (status === 'accepted') {
      const a = Math.min(cr.sender_id, cr.recipient_id)
      const b = Math.max(cr.sender_id, cr.recipient_id)
      const [existingSession] = await db.query('SELECT id FROM chat_sessions WHERE user_a = ? AND user_b = ?', [a, b])
      if (existingSession.length) {
        sessionId = existingSession[0].id
      } else {
        const [result] = await db.query('INSERT INTO chat_sessions (user_a, user_b) VALUES (?,?)', [a, b])
        sessionId = result.insertId
      }
    }
    try { getIO()?.emit('request:update', { id, status, sessionId }) } catch {}
    res.json({ status, sessionId })
  } finally {
    db.release()
  }
})

// list contacts (sessions)
router.get('/sessions', auth, async (req, res) => {
  const userId = req.user.id
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query(
      `SELECT cs.id as session_id,
              CASE WHEN cs.user_a = ? THEN u2.id ELSE u1.id END AS other_id,
              CASE WHEN cs.user_a = ? THEN u2.username ELSE u1.username END AS other_username,
              CASE WHEN cs.user_a = ? THEN u2.profile_pic ELSE u1.profile_pic END AS other_profile_pic,
              (
                SELECT COUNT(*) FROM messages m
                WHERE m.session_id = cs.id AND m.sender_id <> ? AND m.seen = 0
              ) AS unread_count
       FROM chat_sessions cs
       JOIN users u1 ON u1.id = cs.user_a
       JOIN users u2 ON u2.id = cs.user_b
       WHERE cs.user_a = ? OR cs.user_b = ?
       ORDER BY cs.created_at DESC`,
      [userId, userId, userId, userId, userId, userId]
    )
    res.json({ sessions: rows })
  } finally {
    db.release()
  }
})

// fetch messages in a session
// fetch messages in a session with pagination
router.get('/sessions/:id/messages', auth, async (req, res) => {
  const sessionId = Number(req.params.id)
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const beforeId = req.query.before ? Number(req.query.before) : null
  const db = await pool.getConnection()
  try {
    const [allowed] = await db.query('SELECT * FROM chat_sessions WHERE id = ? AND (user_a = ? OR user_b = ?)', [sessionId, req.user.id, req.user.id])
    if (!allowed.length) return res.status(403).json({ error: 'forbidden' })
    const params = [sessionId]
    let where = 'session_id = ?'
    if (beforeId) { where += ' AND id < ?'; params.push(beforeId) }
    // try cache
    const redis = getRedis()
    const cacheKey = beforeId ? `msgs:${sessionId}:before:${beforeId}:limit:${limit}` : `msgs:${sessionId}:latest:limit:${limit}`
    let rows = null
    if (redis) {
      const cached = await redis.get(cacheKey)
      if (cached) rows = JSON.parse(cached)
    }
    if (!rows) {
      const [dbRows] = await db.query(
      `SELECT id, sender_id, session_id, parent_id, forwarded_from_id, ciphertext, iv, auth_tag, created_at, updated_at, delivered, seen, deleted
       FROM messages WHERE ${where} ORDER BY id DESC LIMIT ?`,
      [...params, limit]
      )
      rows = dbRows
      if (redis) await redis.setEx(cacheKey, 30, JSON.stringify(rows))
    }
    rows.reverse()
    const messages = rows.map((r) => ({
      ...r,
      plaintext: r.deleted ? '' : (() => {
        try { return decryptMessage(Buffer.from(r.ciphertext), Buffer.from(r.iv), Buffer.from(r.auth_tag)) } catch { return '' }
      })(),
    }))
    res.json({ messages })
  } finally {
    db.release()
  }
})

// mark session as read (all messages from other user)
router.post('/sessions/:id/read', auth, async (req, res) => {
  const sessionId = Number(req.params.id)
  const db = await pool.getConnection()
  try {
    await db.query('UPDATE messages SET seen = 1 WHERE session_id = ? AND sender_id <> ?', [sessionId, req.user.id])
    res.json({ ok: true })
  } finally { db.release() }
})

// send message (encrypted)
router.post('/sessions/:id/messages', auth, async (req, res) => {
  const sessionId = Number(req.params.id)
  const { text, parentId, forwardFromId } = req.body
  if (typeof text !== 'string' || text.length === 0) return res.status(400).json({ error: 'invalid_text' })
  const db = await pool.getConnection()
  try {
    const [allowed] = await db.query('SELECT * FROM chat_sessions WHERE id = ? AND (user_a = ? OR user_b = ?)', [sessionId, req.user.id, req.user.id])
    if (!allowed.length) return res.status(403).json({ error: 'forbidden' })
    const { ciphertext, iv, authTag } = encryptMessage(text)
    const [result] = await db.query(
      'INSERT INTO messages (session_id, sender_id, parent_id, forwarded_from_id, ciphertext, iv, auth_tag) VALUES (?,?,?,?,?,?,?)',
      [sessionId, req.user.id, parentId || null, forwardFromId || null, ciphertext, iv, authTag]
    )
    const message = { id: result.insertId, sessionId, sender_id: req.user.id, parent_id: parentId || null, forwarded_from_id: forwardFromId || null, ciphertext, iv, auth_tag: authTag, plaintext: text, created_at: new Date().toISOString() }
    try {
      // broadcast to session room
      getIO()?.to(String(sessionId)).emit('message:new', {
        sessionId,
        messageId: message.id,
        ciphertext: message.ciphertext,
        iv: message.iv,
        authTag: message.auth_tag,
        createdAt: message.created_at,
        from: req.user.id,
        plaintext: text,
        parentId: parentId || null,
        forwardFromId: forwardFromId || null,
      })
    } catch {}
    // invalidate cache
    try { const r = getRedis(); await r?.del(`msgs:${sessionId}:latest:limit:50`) } catch {}
    res.json(message)
  } finally {
    db.release()
  }
})

// forward an existing message into another session
router.post('/messages/:id/forward', auth, async (req, res) => {
  const messageId = Number(req.params.id)
  const { toSessionId } = req.body
  const db = await pool.getConnection()
  try {
    const [origRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId])
    if (!origRows.length) return res.status(404).json({ error: 'not_found' })
    const orig = origRows[0]
    const [allowed] = await db.query('SELECT * FROM chat_sessions WHERE id = ? AND (user_a = ? OR user_b = ?)', [toSessionId, req.user.id, req.user.id])
    if (!allowed.length) return res.status(403).json({ error: 'forbidden' })
    const [result] = await db.query(
      'INSERT INTO messages (session_id, sender_id, forwarded_from_id, ciphertext, iv, auth_tag) VALUES (?,?,?,?,?,?)',
      [toSessionId, req.user.id, messageId, orig.ciphertext, orig.iv, orig.auth_tag]
    )
    const createdAt = new Date().toISOString()
    getIO()?.to(String(toSessionId)).emit('message:new', { sessionId: toSessionId, messageId: result.insertId, ciphertext: orig.ciphertext, iv: orig.iv, authTag: orig.auth_tag, createdAt, from: req.user.id, plaintext: null, forwardFromId: messageId })
    res.json({ id: result.insertId, sessionId: toSessionId })
  } finally { db.release() }
})

// simple full-text search (enable only if message_search is populated with plaintext)
router.get('/sessions/:id/search', auth, async (req, res) => {
  const sessionId = Number(req.params.id)
  const q = String(req.query.q || '').trim()
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  if (!q) return res.json({ results: [] })
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query(
      'SELECT message_id as id FROM message_search WHERE session_id = ? AND MATCH(body) AGAINST(? IN NATURAL LANGUAGE MODE) LIMIT ?',
      [sessionId, q, limit]
    )
    res.json({ results: rows.map((r) => r.id) })
  } finally { db.release() }
})

// edit message (owner only)
router.put('/messages/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  const { text } = req.body
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ error: 'not_found' })
    const msg = rows[0]
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'forbidden' })
    const { ciphertext, iv, authTag } = encryptMessage(text)
    await db.query('UPDATE messages SET ciphertext = ?, iv = ?, auth_tag = ?, updated_at = NOW(), deleted = 0 WHERE id = ?', [ciphertext, iv, authTag, id])
    getIO()?.to(String(msg.session_id)).emit('message:edited', { messageId: id, sessionId: msg.session_id, plaintext: text })
    res.json({ ok: true })
  } finally { db.release() }
})

// delete message (owner only)
router.delete('/messages/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ error: 'not_found' })
    const msg = rows[0]
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'forbidden' })
    await db.query('UPDATE messages SET deleted = 1, updated_at = NOW() WHERE id = ?', [id])
    getIO()?.to(String(msg.session_id)).emit('message:deleted', { messageId: id, sessionId: msg.session_id })
    res.json({ ok: true })
  } finally { db.release() }
})

// reactions removed
// list online users (simple presence)
router.get('/online', auth, async (_req, res) => {
  res.json({ users: getOnlineUserIds() })
})

export default router

