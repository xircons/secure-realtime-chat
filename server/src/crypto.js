import crypto from 'crypto'

// AES-256-GCM using a single server-side key derived from env
const base64Key = process.env.MESSAGE_AES_KEY || ''
const key = base64Key ? Buffer.from(base64Key, 'base64') : crypto.createHash('sha256').update('dev_key').digest()

export function encryptMessage(plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { ciphertext, iv, authTag }
}

export function decryptMessage(ciphertext, iv, authTag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return plaintext
}

