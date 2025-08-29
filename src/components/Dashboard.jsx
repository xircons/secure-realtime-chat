import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext.jsx'
import { AuthAPI, ChatAPI, ProfileAPI } from '../api/client.js'
import Contacts from './Contacts.jsx'
import Requests from './Requests.jsx'
import ChatWindow from './ChatWindow.jsx'

export default function Dashboard() {
  const { user, setUser, socket } = useAuth()
  const [sessions, setSessions] = useState([])
  const [requests, setRequests] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [newUsername, setNewUsername] = useState('')
  const [status, setStatus] = useState('online')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [{ sessions }, { requests }] = await Promise.all([ChatAPI.listSessions(), ChatAPI.listRequests()])
    setSessions(sessions)
    setRequests(requests)
    if (!activeSession && sessions[0]) setActiveSession(sessions[0])
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!socket) return
    // join all known session rooms to receive message:new even when not viewing that chat
    sessions.forEach((s) => {
      if (s?.session_id) {
        socket.emit('join:session', { sessionId: String(s.session_id) })
      }
    })

    const onPresence = () => {}
    socket.on('presence:update', onPresence)
    const onRequestChange = () => load()
    socket.on('request:update', onRequestChange)
    const onMessageNew = (m) => {
      // increment unread on the session if it's not the active one and it's from the other user
      setSessions((prev) => prev.map((s) => {
        if (Number(s.session_id) !== Number(m.sessionId)) return s
        const isActive = activeSession && Number(activeSession.session_id) === Number(m.sessionId)
        const fromOther = !m.from || Number(m.from) !== Number(user?.id)
        return isActive || !fromOther ? s : { ...s, unread_count: (s.unread_count || 0) + 1 }
      }))
    }
    socket.on('message:new', onMessageNew)
    return () => {
      socket.off('presence:update', onPresence)
      socket.off('request:update', onRequestChange)
      socket.off('message:new', onMessageNew)
    }
  }, [socket, sessions, activeSession, user])

  async function logout() {
    await AuthAPI.logout()
    setUser(null)
  }

  async function saveProfile(e) {
    e?.preventDefault?.()
    try {
      setBusy(true)
      if (newUsername && newUsername !== user?.username) {
        await ProfileAPI.update(newUsername)
        setUser({ ...user, username: newUsername })
      }
      if (status) {
        await ProfileAPI.setStatus(status)
      }
      await load()
    } finally { setBusy(false) }
  }

  async function onAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const { profile_pic } = await ProfileAPI.uploadAvatar(file)
      setUser({ ...user, profile_pic })
    } finally { setBusy(false) }
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="profile">
          {user?.profile_pic ? (
            <img className="avatar" src={user.profile_pic} alt="avatar" />
          ) : (
            <img className="avatar" src="/user.jpg" alt="avatar" />
          )}
          <div>
            <div className="title">{user?.username}</div>
            <div className="subtitle">Online</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button onClick={logout}>Logout</button>
          </div>
        </div>
        <Requests requests={requests} onChanged={load} />
        <form onSubmit={saveProfile} className="profile-editor" style={{ display:'grid', gap:8 }}>
          <h2>Profile</h2>
          <input placeholder="New username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          {/* status feature removed */}
          <label style={{ fontSize:12, color:'var(--muted)' }}>Avatar</label>
          <input type="file" accept="image/*" onChange={onAvatarChange} />
          <button disabled={busy} type="submit">Save</button>
        </form>
        <Contacts sessions={sessions} onSelect={setActiveSession} active={activeSession?.session_id} />
      </aside>

      <main className="chat-area">
        {activeSession ? (
          <ChatWindow session={activeSession} />
        ) : (
          <div className="empty" style={{ padding: 24, color: 'var(--muted)' }}>Select a conversation</div>
        )}
      </main>
    </div>
  )
}


