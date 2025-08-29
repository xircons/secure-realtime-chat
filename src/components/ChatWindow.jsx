import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../AuthContext.jsx'
import { ChatAPI } from '../api/client.js'

export default function ChatWindow({ session }) {
  const { socket, user } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)
  const listRef = useRef(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const peerTypingTimerRef = useRef(null)
  const typingIntervalRef = useRef(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [openMenuPos, setOpenMenuPos] = useState('bottom') // 'bottom' | 'top'
  const [replyTo, setReplyTo] = useState(null)
  const [hiddenIds, setHiddenIds] = useState([])

  useEffect(() => {
    let mounted = true
    ChatAPI.listMessages(session.session_id, { limit: 50 }).then(({ messages }) => {
      if (mounted) setMessages(messages)
    })
    if (socket) {
      socket.emit('join:session', { sessionId: String(session.session_id) })
    }
    // mark read
    ChatAPI.markRead(session.session_id).catch(() => {})
    // reset any reply target when switching chats
    setReplyTo(null)
    // load hidden ids for this user+session from localStorage
    try {
      const key = `hidden:${user?.id}:${session.session_id}`
      const raw = localStorage.getItem(key)
      const arr = raw ? JSON.parse(raw) : []
      setHiddenIds(Array.isArray(arr) ? arr : [])
    } catch {}
    return () => { mounted = false }
  }, [session.session_id, socket])

  useEffect(() => {
    if (!socket) return
    const onNew = (m) => {
      if (Number(m.sessionId) !== Number(session.session_id)) return
      if (m.from && Number(m.from) === Number(user.id)) {
        // For the sender, we already optimistically added the message
        return
      }
      const normalized = {
        ...m,
        id: m.id ?? m.messageId,
        parent_id: m.parent_id ?? m.parentId ?? null,
        forwarded_from_id: m.forwarded_from_id ?? m.forwardFromId ?? null,
      }
      setMessages((prev) => {
        const exists = prev.some((x) => (x.id ?? x.messageId) === normalized.id)
        return exists ? prev : [...prev, normalized]
      })
    }
    socket.on('message:new', onNew)
    const onEdited = ({ messageId, plaintext }) => {
      setMessages((prev) => prev.map((m) => (Number(m.id || m.messageId) === Number(messageId) ? { ...m, plaintext } : m)))
    }
    const onDeleted = ({ messageId }) => {
      setMessages((prev) => prev.map((m) => (Number(m.id || m.messageId) === Number(messageId) ? { ...m, plaintext: '', deleted: true } : m)))
    }
    const onReaction = ({ messageId, userId, emoji }) => {
      setMessages((prev) => prev.map((m) => {
        if (Number(m.id || m.messageId) !== Number(messageId)) return m
        const next = { ...m }
        const reactions = new Map(Object.entries(next.reactions || {}))
        if (!emoji) {
          reactions.delete(String(userId))
        } else {
          reactions.set(String(userId), emoji)
        }
        next.reactions = Object.fromEntries(reactions)
        return next
      }))
    }
    socket.on('message:edited', onEdited)
    socket.on('message:deleted', onDeleted)
    socket.on('message:reaction', onReaction)
    const onTyping = ({ userId, sessionId, isTyping }) => {
      if (Number(sessionId) !== Number(session.session_id)) return
      if (Number(userId) === Number(user.id)) return
      if (peerTypingTimerRef.current) { clearTimeout(peerTypingTimerRef.current) }
      setPeerTyping(Boolean(isTyping))
      if (isTyping) {
        peerTypingTimerRef.current = setTimeout(() => setPeerTyping(false), 3000)
      }
    }
    socket.on('typing', onTyping)
    return () => {
      socket.off('message:new', onNew)
      socket.off('message:edited', onEdited)
      socket.off('message:deleted', onDeleted)
      socket.off('message:reaction', onReaction)
      socket.off('typing', onTyping)
    }
  }, [socket, session.session_id])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const val = text.trim()
    if (!val) return
    // Ensure reply target belongs to this session (avoid cross-chat replies)
    const validParentId = replyTo && messages.some((m) => Number(m.id || m.messageId) === Number(replyTo.id)) ? replyTo.id : null
    const { id, ciphertext, iv, auth_tag } = await ChatAPI.sendMessage(session.session_id, val, { parentId: validParentId })
    setText('')
    const createdAt = new Date().toISOString()
    const localMessage = { id, sessionId: session.session_id, ciphertext, iv, authTag: auth_tag, createdAt, from: user.id, plaintext: val, parent_id: validParentId }
    setMessages((prev) => [...prev, localMessage])
    socket?.emit('message:sent', { sessionId: session.session_id, messageId: id, ciphertext, iv, authTag: auth_tag, createdAt })
    // stop typing after send
    setTyping(false)
    setReplyTo(null)
  }

  async function loadMore() {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const firstId = messages[0].id || messages[0].messageId
    const { messages: older } = await ChatAPI.listMessages(session.session_id, { before: firstId, limit: 50 })
    setMessages((prev) => [...older, ...prev])
    setLoadingMore(false)
  }

  async function editMessage(id) {
    const value = prompt('Edit message:')
    if (value == null) return
    await ChatAPI.editMessage(id, value)
  }

  async function deleteMessage(id) {
    if (!confirm('Delete message?')) return
    await ChatAPI.deleteMessage(id)
  }

  function onReply(m) {
    const mid = m.id || m.messageId
    setReplyTo({ id: mid, preview: m.plaintext?.slice(0, 140) || '' })
  }

  function cancelReply() { setReplyTo(null) }


  function handleTyping(e) {
    const value = e.target.value
    setText(value)
    const willType = value.trim().length > 0
    if (willType !== typing) {
      setTyping(willType)
    }
  }

  useEffect(() => {
    if (!socket) return
    if (typing) {
      socket.emit('typing', { sessionId: String(session.session_id), isTyping: true })
      typingIntervalRef.current = setInterval(() => {
        socket.emit('typing', { sessionId: String(session.session_id), isTyping: true })
      }, 1500)
    } else {
      socket.emit('typing', { sessionId: String(session.session_id), isTyping: false })
    }
    return () => {
      if (typingIntervalRef.current) { clearInterval(typingIntervalRef.current); typingIntervalRef.current = null }
    }
  }, [typing, socket, session.session_id])

  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) { clearInterval(typingIntervalRef.current) }
      if (peerTypingTimerRef.current) { clearTimeout(peerTypingTimerRef.current) }
      socket?.emit('typing', { sessionId: String(session.session_id), isTyping: false })
    }
  }, [socket, session.session_id])

  function toggleMenu(id, evt) {
    if (evt && evt.currentTarget) {
      const rect = evt.currentTarget.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setOpenMenuPos(spaceBelow < 140 && spaceAbove > spaceBelow ? 'top' : 'bottom')
    }
    setOpenMenuId((cur) => (cur === id ? null : id))
  }

  function closeMenuSoon() {
    // Delay to allow click on menu items
    setTimeout(() => setOpenMenuId(null), 100)
  }

  function hideMessage(id) {
    const key = `hidden:${user?.id}:${session.session_id}`
    setHiddenIds((prev) => {
      const next = Array.from(new Set([...(prev || []), Number(id)]))
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div className="chat-window">
      <div className="header">
        {session.other_profile_pic ? (
          <img className="avatar" src={session.other_profile_pic} alt="avatar" />
        ) : (
          <img className="avatar" src="/user.jpg" alt="avatar" />
        )}
        <div>
          <div className="title">{session.other_username}</div>
          <div className="subtitle">Private chat</div>
        </div>
      </div>
      <div className="messages" ref={listRef} onScroll={(e) => { if (e.currentTarget.scrollTop < 40) loadMore() }}>
        {messages.map((m, idx) => {
          const id = m.id || m.messageId
          const mine = Number(m.sender_id || m.from) === Number(user.id)
          const createdAtMs = (() => {
            const t = m.createdAt || m.created_at
            return t ? new Date(t).getTime() : Date.now()
          })()
          const prevMs = idx > 0 ? (() => {
            const p = messages[idx - 1]
            const pt = p.createdAt || p.created_at
            return pt ? new Date(pt).getTime() : createdAtMs
          })() : null
          const showDivider = idx === 0 || (prevMs != null && (createdAtMs - prevMs) >= 3 * 60 * 1000)
          const time = new Date(createdAtMs).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
          return (
            <>
              {showDivider && (
                <div className="time-divider"><span>{time}</span></div>
              )}
              {hiddenIds?.includes(Number(id)) ? null : (
              <div key={id} className={`message-row ${mine ? 'me' : 'other'}`}>
                {!mine && (
                  <div className="avatar-holder">
                    {session.other_profile_pic ? (
                      <img className="avatar" src={session.other_profile_pic} alt="" />
                    ) : (
                      <img className="avatar" src="/user.jpg" alt="" />
                    )}
                  </div>
                )}
                <div className="message-content">
                  <div className={`bubble-row ${mine ? 'me' : 'other'}`}>
                    {/* actions for both sides: reply always available; edit/delete only mine */}
                    {!m.deleted && (
                      <div className="message-actions inline">
                        {mine ? (
                          <>
                            <button className="menu-btn" onClick={(e) => toggleMenu(id, e)} onBlur={closeMenuSoon} aria-label="Message menu">⋮</button>
                            {openMenuId === id && (
                              <div className={`menu ${openMenuPos}`} onMouseLeave={closeMenuSoon}>
                                <button onMouseDown={() => editMessage(id)}>Edit</button>
                                <button className="danger" onMouseDown={() => deleteMessage(id)}>Delete</button>
                                <button onMouseDown={() => onReply({ id, plaintext: m.plaintext })}>Reply</button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <button className="menu-btn" onClick={(e) => toggleMenu(id, e)} onBlur={closeMenuSoon} aria-label="Message menu">⋮</button>
                            {openMenuId === id && (
                              <div className={`menu ${openMenuPos}`} onMouseLeave={closeMenuSoon}>
                                <button onMouseDown={() => onReply({ id, plaintext: m.plaintext })}>Reply</button>
                                <button className="danger" onMouseDown={() => hideMessage(id)}>Hide</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <div className={`bubble ${mine ? 'me' : ''}`}>
                      {m.parent_id && (
                        <div className="reply-inline">
                          <span className="reply-label">Replying to</span>
                          <span className="reply-quote">{(() => {
                            const p = messages.find((x) => Number(x.id || x.messageId) === Number(m.parent_id))
                            const txt = p?.plaintext || ''
                            return txt ? (txt.length > 120 ? txt.slice(0, 120) + '…' : txt) : `#${m.parent_id}`
                          })()}</span>
                        </div>
                      )}
                      <div className="text">{m.deleted ? '[deleted]' : m.plaintext ? m.plaintext : '[encrypted]'}</div>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </>
          )
        })}
        {peerTyping && (
          <div className="message-row other">
            <div className="avatar-holder">
              {session.other_profile_pic ? (
                <img className="avatar" src={session.other_profile_pic} alt="" />
              ) : (
                <img className="avatar" src="/user.jpg" alt="" />
              )}
            </div>
            <div className="message-content">
              <div className="bubble typing">
                <div className="dot" />
                <div className="dot" />
                <div className="dot" />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="composer">
        {replyTo && (
          <div className="reply-bar">
            <span>Replying to : {replyTo.preview}</span>
            <button className="btn sm" onClick={cancelReply}>Cancel</button>
          </div>
        )}
        <input value={text} onChange={handleTyping} onKeyDown={(e) => e.key === 'Enter' ? send() : null} placeholder="Type a message" />
        <button onClick={send}>Send</button>
      </div>
    </div>
  )
}


