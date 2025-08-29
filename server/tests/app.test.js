import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import http from 'http'
import app from '../src/app.js'
import { encryptMessage, decryptMessage } from '../src/crypto.js'

describe('health', () => {
  let server
  beforeAll(() => {
    server = http.createServer(app)
  })

  it('GET /api/health ok', async () => {
    const res = await request(server).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
  it('encrypt/decrypt roundtrip', () => {
    const sample = 'hello world'
    const { ciphertext, iv, authTag } = encryptMessage(sample)
    const back = decryptMessage(ciphertext, iv, authTag)
    expect(back).toBe(sample)
  })
})

