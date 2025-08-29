import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AuthAPI } from './api/client.js'
import { createSocket } from './api/socket.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [socket, setSocket] = useState(null)

  useEffect(() => {
    AuthAPI.me().then(({ user }) => setUser(user)).catch(() => {})
  }, [])

  useEffect(() => {
    // Connect when we have a token OR a known user (cookie-based auth)
    if (!token && !user) return
    const s = createSocket(token)
    s.connect()
    setSocket(s)
    return () => s.disconnect()
  }, [token, user])

  const value = useMemo(() => ({ user, setUser, token, setToken, socket }), [user, token, socket])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}


