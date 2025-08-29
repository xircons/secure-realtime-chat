import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export function createSocket(token) {
  const options = {
    autoConnect: false,
    transports: ['websocket'],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  }
  if (token) {
    options.auth = { token }
  }
  const socket = io(SOCKET_URL, options)
  socket.on('connect_error', () => {})
  socket.on('reconnect_attempt', () => {})
  socket.on('reconnect', () => {})
  return socket
}


