export default function Contacts({ sessions, onSelect, active }) {
  return (
    <div className="contacts">
      <h3>Chats</h3>
      {sessions.map((s) => (
        <div key={`session-${s.session_id}`} className={`contact ${active === s.session_id ? 'active' : ''}`} onClick={() => onSelect(s)}>
          {s.other_profile_pic ? (
            <img
              src={s.other_profile_pic}
              alt=""
              style={{ width:28, height:28, borderRadius: '50%', objectFit:'cover' }}
            />
          ) : (
            <img
              src="/user.jpg"
              alt=""
              style={{ width:28, height:28, borderRadius: '50%', objectFit:'cover' }}
            />
          )}
          <div className="name">{s.other_username}</div>
          <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap:8 }}>
            {s.unread_count > 0 && <span className="unread">{s.unread_count}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}


