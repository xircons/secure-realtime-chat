import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
// Redis is optional; load dynamically only if REDIS_URL is set

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'secure_chat',
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true,
})

export async function ensureSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  })
  const dbName = process.env.DB_NAME || 'secure_chat'
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await connection.end()

  const schemaPath = path.join(__dirname, 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  const db = await pool.getConnection()
  try {
    await db.query(schemaSql)
    // Simple connection test and log similar to CJS example
    await db.query('SELECT 1')
    // eslint-disable-next-line no-console
    console.log('✅ Connected to MySQL as id', db.threadId)
  } finally {
    db.release()
  }
}

export { pool }

// Redis client (optional)
let redisClient = null
let redisInitStarted = false
export function getRedis() {
  if (redisClient) return redisClient
  const url = process.env.REDIS_URL || null
  if (!url) return null
  if (!redisInitStarted) {
    redisInitStarted = true
    import('redis').then(({ createClient }) => {
      try {
        redisClient = createClient({ url })
        redisClient.on('error', (e) => { /* eslint-disable no-console */ console.error('redis error', e) })
        redisClient.connect().catch(() => {})
      } catch {}
    }).catch(() => {})
  }
  return null
}

