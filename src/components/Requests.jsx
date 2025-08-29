import { useState } from 'react'
import { ChatAPI } from '../api/client.js'
import { useAuth } from '../AuthContext.jsx'

export default function Requests({ requests, onChanged }) {
  const { user } = useAuth()
  const [toUsername, setToUsername] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function sendRequest(e) {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      await ChatAPI.sendRequest(toUsername.trim())
      setToUsername('')
      onChanged?.()
    } catch (e) {
      setError(e?.data?.error || 'error')
    } finally {
      setSending(false)
    }
  }

  async function respond(id, action) {
    await ChatAPI.respondRequest(id, action)
    onChanged?.()
  }
  return (
    <div className="requests">
      <h3>Requests</h3>
      <form onSubmit={sendRequest} className="request-send">
        <input placeholder="Send request to username" value={toUsername} onChange={(e) => setToUsername(e.target.value)} required />
        <button type="submit" disabled={sending}>Send</button>
      </form>
      {error && <div className="error">{error}</div>}
      {requests.map((r) => {
        const isRecipient = r.recipient === user?.username
        const otherUser = isRecipient ? r.sender : r.recipient
        const direction = '→'
        return (
          <div key={`request-${r.id}`} className="request">
            <div style={{ display:'grid' }}>
              <div style={{ fontWeight:600 }}>{otherUser}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>{r.sender} {direction} {r.recipient}</div>
            </div>
            <div className="req-right">
              {r.status === 'accepted' && <span className="status accepted">accepted</span>}
              {r.status === 'declined' && <span className="status declined">declined</span>}
              {r.status === 'pending' && isRecipient && (
                <div className="actions">
                  <button className="btn sm" onClick={() => respond(r.id, 'accept')}>Accept</button>
                  <button className="btn sm danger" onClick={() => respond(r.id, 'decline')}>Decline</button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


