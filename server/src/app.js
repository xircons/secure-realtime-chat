import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import authRouter from './routes.auth.js'
import profileRouter from './routes.profile.js'
import chatRouter from './routes.chat.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Allow multiple dev origins by default; can be overridden via CORS_ORIGIN env (comma-separated)
const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174']
const allowedOrigins = (process.env.CORS_ORIGIN?.split(',') || defaultOrigins).map((o) => o.trim())

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    callback(null, allowedOrigins.includes(origin))
  },
  credentials: true,
}))
app.options('*', cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    callback(null, allowedOrigins.includes(origin))
  },
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

// static serving for uploaded profile pictures
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))
app.use('/server/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// root info
app.get('/', (_req, res) => {
  res.type('text/plain').send('Secure Realtime Chat API is running. Try GET /api/health')
})

// healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// routers
app.use('/api/auth', authRouter)
app.use('/api/profile', profileRouter)
app.use('/api/chat', chatRouter)

export default app

