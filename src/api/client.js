const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

async function doFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

export async function api(path, options = {}) {
  let { res, data } = await doFetch(path, options)
  if (res.status === 401) {
    // try refresh
    await doFetch('/api/auth/refresh', { method: 'POST' }).catch(() => ({}))
    ;({ res, data } = await doFetch(path, options))
  }
  if (!res.ok) throw Object.assign(new Error('API error'), { status: res.status, data })
  return data
}

export const AuthAPI = {
  register: (username) => api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username }) }),
  login: (username) => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username }) }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  me: () => api('/api/auth/me'),
  refresh: () => api('/api/auth/refresh', { method: 'POST' }),
}

export const ProfileAPI = {
  get: () => api('/api/profile'),
  update: (username) => api('/api/profile/update', { method: 'POST', body: JSON.stringify({ username }) }),
  uploadAvatar: async (file) => {
    const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await fetch(`${API}/api/profile/avatar`, { method: 'POST', credentials: 'include', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error('upload_failed')
    return data
  },
  setStatus: (status) => api('/api/profile/status', { method: 'POST', body: JSON.stringify({ status }) }),
}

export const ChatAPI = {
  sendRequest: (toUsername) => api('/api/chat/request', { method: 'POST', body: JSON.stringify({ toUsername }) }),
  listRequests: () => api('/api/chat/requests'),
  respondRequest: (id, action) => api(`/api/chat/request/${id}/respond`, { method: 'POST', body: JSON.stringify({ action }) }),
  listSessions: () => api('/api/chat/sessions'),
  listMessages: (sessionId, { before, limit } = {}) => {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    if (limit) params.set('limit', String(limit))
    const q = params.toString()
    return api(`/api/chat/sessions/${sessionId}/messages${q ? `?${q}` : ''}`)
  },
  sendMessage: (sessionId, text, { parentId, forwardFromId } = {}) => api(`/api/chat/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ text, parentId, forwardFromId }) }),
  editMessage: (id, text) => api(`/api/chat/messages/${id}`, { method: 'PUT', body: JSON.stringify({ text }) }),
  deleteMessage: (id) => api(`/api/chat/messages/${id}`, { method: 'DELETE' }),
  addReaction: (id, emoji) => api(`/api/chat/messages/${id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  removeReaction: (id, emoji) => api(`/api/chat/messages/${id}/reactions`, { method: 'DELETE', body: JSON.stringify({ emoji }) }),
  markRead: (sessionId) => api(`/api/chat/sessions/${sessionId}/read`, { method: 'POST' }),
  forward: (messageId, toSessionId) => api(`/api/chat/messages/${messageId}/forward`, { method: 'POST', body: JSON.stringify({ toSessionId }) }),
  search: (sessionId, q, limit) => api(`/api/chat/sessions/${sessionId}/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`),
}


