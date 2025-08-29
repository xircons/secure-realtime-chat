import { useState } from 'react'
import { AuthAPI, ProfileAPI } from '../api/client.js'
import { useAuth } from '../AuthContext.jsx'

export default function Login() {
  const { setUser, setToken } = useAuth()
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState(null)
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      const fn = mode === 'register' ? AuthAPI.register : AuthAPI.login
      const { user, token } = await fn(username.trim())
      if (avatar && mode === 'register') {
        try { await ProfileAPI.uploadAvatar(avatar) } catch {}
      }
      setToken(token)
      setUser(user)
    } catch (e) {
      setError(e?.data?.error || 'error')
    }
  }

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === 'register' ? 'Register' : 'Login'}</h2>
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={32} />
        {mode === 'register' && (
          <input type="file" accept="image/*" onChange={(e) => setAvatar(e.target.files?.[0] || null)} />
        )}
        {error && <div className="error">{error}</div>}
        <button type="submit">{mode === 'register' ? 'Create Account' : 'Login'}</button>
        <div className="switch">
          {mode === 'register' ? (
            <span>Have an account? <a href="#" onClick={() => setMode('login')}>Login</a></span>
          ) : (
            <span>New here? <a href="#" onClick={() => setMode('register')}>Register</a></span>
          )}
        </div>
      </form>
    </div>
  )
}


