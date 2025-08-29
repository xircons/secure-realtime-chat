import { Router } from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname || '')
    cb(null, unique + ext)
  },
})

const upload = multer({ storage })

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

router.get('/', auth, async (req, res) => {
  const db = await pool.getConnection()
  try {
    const [rows] = await db.query('SELECT id, username, profile_pic FROM users WHERE id = ?', [req.user.id])
    res.json({ user: rows[0] })
  } finally {
    db.release()
  }
})

router.post('/update', auth, async (req, res) => {
  const { username } = req.body
  if (!username || /\s/.test(username) || username.length > 32) {
    return res.status(400).json({ error: 'invalid_username' })
  }
  const db = await pool.getConnection()
  try {
    const [taken] = await db.query('SELECT id FROM users WHERE username = ? AND id <> ?', [username, req.user.id])
    if (taken.length) return res.status(409).json({ error: 'username_taken' })
    await db.query('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id])
    res.json({ ok: true })
  } finally {
    db.release()
  }
})

router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  // Persist Windows-style prefixed path for your requirement
  const filePath = `server\\uploads\\${req.file.filename}`
  const db = await pool.getConnection()
  try {
    await db.query('UPDATE users SET profile_pic = ? WHERE id = ?', [filePath, req.user.id])
    res.json({ profile_pic: filePath })
  } finally {
    db.release()
  }
})

// update custom status
router.post('/status', auth, async (req, res) => {
  const { status } = req.body // 'online' | 'away' | 'busy' | 'offline'
  if (!['online', 'away', 'busy', 'offline'].includes(status)) return res.status(400).json({ error: 'invalid_status' })
  const db = await pool.getConnection()
  try {
    await db.query('UPDATE users SET status = ? WHERE id = ?', [status, req.user.id])
    res.json({ status })
  } finally {
    db.release()
  }
})

export default router

