import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'

const connectedUsers = new Map()
let ioRef = null

export function getIO() {
  return ioRef
}

export function getOnlineUserIds() {
  return Array.from(connectedUsers.keys())
}

export function attachSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
      credentials: true,
    },
  })
  ioRef = io

  io.use((socket, next) => {
    try {
      let token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token']
      if (!token) {
        const cookieHeader = socket.handshake.headers.cookie || ''
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map((c) => {
            const idx = c.indexOf('=')
            if (idx === -1) return [c.trim(), '']
            const key = c.slice(0, idx).trim()
            const val = decodeURIComponent(c.slice(idx + 1))
            return [key, val]
          })
        )
        token = cookies.token
      }
      if (!token) return next(new Error('unauthorized'))
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret')
      socket.user = { id: payload.sub, username: payload.username }
      next()
    } catch (e) {
      next(e)
    }
  })

  io.on('connection', (socket) => {
    const userId = socket.user.id
    connectedUsers.set(userId, socket.id)
    io.emit('presence:update', { userId, online: true })

    socket.on('typing', ({ sessionId, isTyping }) => {
      socket.to(sessionId).emit('typing', { userId, sessionId, isTyping })
    })

    socket.on('join:session', ({ sessionId }) => {
      socket.join(sessionId)
    })

    socket.on('message:sent', async (payload) => {
      const { sessionId, messageId } = payload
      try {
        const db = await pool.getConnection()
        try {
          await db.query('UPDATE messages SET delivered = 1 WHERE id = ?', [messageId])
        } finally {
          db.release()
        }
      } catch {}
      socket.to(String(sessionId)).emit('message:delivered', { sessionId, messageId })
    })

    socket.on('message:seen', ({ sessionId, messageId }) => {
      ;(async () => {
        try {
          const db = await pool.getConnection()
          try {
            if (messageId) {
              await db.query('UPDATE messages SET seen = 1 WHERE id = ?', [messageId])
            } else {
              await db.query('UPDATE messages SET seen = 1 WHERE session_id = ? AND sender_id <> ?', [sessionId, userId])
            }
          } finally {
            db.release()
          }
        } catch {}
      })()
      socket.to(String(sessionId)).emit('message:seen', { sessionId, messageId, by: userId })
    })

    socket.on('disconnect', () => {
      connectedUsers.delete(userId)
      io.emit('presence:update', { userId, online: false })
    })
  })

  return io
}

