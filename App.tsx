// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type User = {
  id: string
  username: string
  password: string
  phone: string
  country: string
  profileName?: string
  avatar?: string
  isOnline: boolean
  verified: boolean
  blocked: boolean
  banned: boolean
  bannedReason?: string | null
  lastSeen: string
  primeBalance: number
  pulseBalance: number
}

type Message = {
  id: string
  from: string
  to: string
  text: string
  createdAt: string
  delivered: boolean
  read: boolean
}

type Page = 'login' | 'register' | 'home'

type SessionData = {
  userId: string
  token: string
}

type CallType = 'audio' | 'video'

type IncomingCall = {
  from: string
  fromName: string
  offer: RTCSessionDescriptionInit
  type: CallType
}

const defaultUsers: User[] = [
  {
    id: 'u1',
    username: 'waveadmin',
    password: '571631',
    phone: '+994123456789',
    country: 'Azerbaycan',
    profileName: 'WaveTalk',
    avatar: '',
    isOnline: true,
    verified: true,
    blocked: false,
    banned: false,
    bannedReason: null,
    lastSeen: 'Şimdi',
    primeBalance: 0,
    pulseBalance: 0,
  },
]

const countries = [
  { code: '+90', name: 'Türkiye' },
  { code: '+994', name: 'Azerbaycan' },
  { code: '+1', name: 'USA' },
  { code: '+44', name: 'UK' },
]

const randomPhone = (code: string, existing: string[]) => {
  let candidate = ''
  do {
    candidate = `${code}${Math.floor(100000000 + Math.random() * 900000000)}`
  } while (existing.includes(candidate))
  return candidate
}

const sessionKey = 'wave-talk-session'

const loadSession = (): SessionData | null => {
  try {
    const raw = localStorage.getItem(sessionKey)
    if (!raw) return null
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

const saveSession = (session: SessionData | null) => {
  if (!session) {
    localStorage.removeItem(sessionKey)
    return
  }
  localStorage.setItem(sessionKey, JSON.stringify(session))
}

function App() {
  const [page, setPage] = useState<Page>('login')
  const [serverUsers, setServerUsers] = useState<User[]>(defaultUsers)
  const [serverMessages, setServerMessages] = useState<Message[]>([])
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState<SessionData | null>(loadSession())
  const [loginError, setLoginError] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [selectedCountry, setSelectedCountry] = useState(countries[0].code)
  const [selectedPhone, setSelectedPhone] = useState('')
  const [searchText, setSearchText] = useState('')
  const [selectedChatUserId, setSelectedChatUserId] = useState<string | null>(null)
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginPhone, setLoginPhone] = useState('')
  const [regUsername, setRegUsername] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regProfileName, setRegProfileName] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [callState, setCallState] = useState<'idle' | 'calling' | 'incoming' | 'inCall'>('idle')
  const [callType, setCallType] = useState<CallType>('audio')
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [callTargetId, setCallTargetId] = useState<string | null>(null)
  const [callError, setCallError] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const socketUrl = (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')
    const socketClient = io(socketUrl, {
      transports: ['websocket'],
    })

    setSocket(socketClient)

    socketClient.on('connect', () => {
      setConnected(true)
      setConnectionError('')
      if (session) {
        socketClient.emit('resume_session', session)
      }
    })

    socketClient.on('disconnect', () => {
      setConnected(false)
      setCallError('Sunucu bağlantısı kesildi.')
    })

    socketClient.on('connect_error', () => {
      setConnectionError('Sunucuya bağlanılamadı. İnternet bağlantısını kontrol edin.')
      setConnected(false)
    })

    socketClient.on('state_update', ({ users, messages }: { users: User[]; messages: Message[] }) => {
      setServerUsers(users)
      setServerMessages(messages)
    })

    socketClient.on('login_success', ({ session }: { session: SessionData }) => {
      setSession(session)
      saveSession(session)
      setPage('home')
      setLoginError('')
    })

    socketClient.on('login_error', (message: string) => {
      setLoginError(message)
    })

    socketClient.on('register_success', ({ session }: { session: SessionData }) => {
      setSession(session)
      saveSession(session)
      setPage('home')
      setRegisterError('')
    })

    socketClient.on('register_error', (message: string) => {
      setRegisterError(message)
    })

    socketClient.on('message_received', (message: Message) => {
      setServerMessages((prev) => [...prev, message])
    })

    socketClient.on('incoming_call', (call: IncomingCall) => {
      setIncomingCall(call)
      setCallState('incoming')
      setCallTargetId(call.from)
      setCallType(call.type)
    })

    socketClient.on('call_answer', async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnection) return
      await peerConnection.setRemoteDescription(answer)
      setCallState('inCall')
    })

    socketClient.on('ice_candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (!peerConnection || !candidate) return
      try {
        await peerConnection.addIceCandidate(candidate)
      } catch (error) {
        console.error('ICE adayı eklenemedi', error)
      }
    })

    socketClient.on('call_rejected', () => {
      setCallError('Çağrı reddedildi.')
      cleanupCall()
    })

    socketClient.on('call_ended', () => {
      cleanupCall()
    })

    return () => {
      socketClient.disconnect()
      cleanupCall()
    }
  }, [peerConnection, session])

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  const currentUser = useMemo(
    () => serverUsers.find((user) => user.id === session?.userId),
    [serverUsers, session],
  )

  const availablePhone = useMemo(() => {
    const existingPhones = serverUsers.map((user) => user.phone)
    return randomPhone(selectedCountry, existingPhones)
  }, [selectedCountry, serverUsers])

  const cleanupCall = () => {
    setCallState('idle')
    setCallError('')
    setIncomingCall(null)
    setCallTargetId(null)
    setCallType('audio')
    if (peerConnection) {
      peerConnection.close()
      setPeerConnection(null)
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop())
      setLocalStream(null)
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop())
      setRemoteStream(null)
    }
  }

  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && session?.userId) {
        socket.emit('ice_candidate', {
          from: session.userId,
          to: targetId,
          candidate: event.candidate,
        })
      }
    }

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0])
    }

    return pc
  }

  const startCall = async (type: CallType) => {
    if (!socket || !session?.userId || !selectedChatUserId) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
      setLocalStream(stream)
      const pc = createPeerConnection(selectedChatUserId)
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))
      setPeerConnection(pc)
      setCallState('calling')
      setCallTargetId(selectedChatUserId)
      setCallType(type)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      socket.emit('call_user', {
        from: session.userId,
        to: selectedChatUserId,
        offer,
        type,
        fromName: currentUser?.profileName || currentUser?.username || '',
      })
    } catch (error) {
      setCallError('Sesli/görüntülü arama başlatılamadı. Mikrofon veya kamera izinlerini kontrol edin.')
      console.error(error)
    }
  }

  const acceptCall = async () => {
    if (!socket || !session?.userId || !incomingCall) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingCall.type === 'video' })
      setLocalStream(stream)
      const pc = createPeerConnection(incomingCall.from)
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))
      setPeerConnection(pc)
      setCallState('inCall')
      setCallTargetId(incomingCall.from)
      setCallType(incomingCall.type)

      await pc.setRemoteDescription(incomingCall.offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('call_answer', {
        from: session.userId,
        to: incomingCall.from,
        answer,
      })
      setIncomingCall(null)
    } catch (error) {
      setCallError('Çağrı kabul edilemedi. Mikrofon veya kamera izinlerini kontrol edin.')
      console.error(error)
      cleanupCall()
    }
  }

  const rejectCall = () => {
    if (!socket || !session?.userId || !incomingCall) return
    socket.emit('reject_call', {
      from: session.userId,
      to: incomingCall.from,
    })
    cleanupCall()
  }

  const hangupCall = () => {
    if (socket && session?.userId && callTargetId) {
      socket.emit('end_call', {
        from: session.userId,
        to: callTargetId,
      })
    }
    cleanupCall()
  }

  const handleLogin = () => {
    if (!socket) {
      setLoginError('Sunucu bağlı değil.')
      return
    }
    socket.emit('login', {
      username: loginName,
      password: loginPassword,
      phone: loginPhone,
    })
  }

  const handleRegister = () => {
    if (!socket) {
      setRegisterError('Sunucu bağlı değil.')
      return
    }
    socket.emit('register', {
      username: regUsername,
      password: regPassword,
      country: selectedCountry,
      phone: selectedPhone || availablePhone,
      profileName: regProfileName || regUsername,
    })
  }

  const handleLogout = () => {
    socket?.emit('logout')
    cleanupCall()
    setSession(null)
    saveSession(null)
    setPage('login')
    setSelectedChatUserId(null)
  }

  const filteredUsers = serverUsers.filter(
    (user) => user.id !== session?.userId && user.username.toLowerCase().includes(searchText.toLowerCase()),
  )

  const currentMessages = selectedChatUserId
    ? serverMessages.filter((message) => {
        return (
          (message.from === session?.userId && message.to === selectedChatUserId) ||
          (message.from === selectedChatUserId && message.to === session?.userId)
        )
      })
    : []

  const addMessage = (text: string) => {
    if (!session?.userId || !selectedChatUserId || !socket) return
    socket.emit('send_message', {
      from: session.userId,
      to: selectedChatUserId,
      text,
    })
  }

  const renderLogin = () => {
    return (
      <div className="page-shell">
        <div className="auth-panel">
          <h1>WaveTalk</h1>
          <p>Gerçek zamanlı internet sohbet uygulaması</p>
          <div className="auth-form">
            <label>Kullanıcı adı</label>
            <input value={loginName} placeholder="Kullanıcı adınızı yazın" onChange={(e) => setLoginName(e.target.value)} />
            <label>Parola</label>
            <input
              type="password"
              value={loginPassword}
              placeholder="Parolanızı yazın"
              onChange={(e) => setLoginPassword(e.target.value)}
            />
            <label>Numara</label>
            <input value={loginPhone} placeholder="+994123456789" onChange={(e) => setLoginPhone(e.target.value)} />
            <button onClick={handleLogin}>Giriş Yap</button>
            {loginError && <div className="error">{loginError}</div>}
            {connectionError && <div className="error">{connectionError}</div>}
            <div className="auth-switch">
              <span>Hesabın yok mu?</span>
              <button onClick={() => { setPage('register'); setRegisterError(''); setLoginError('') }}>Kayıt Ol</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderRegister = () => {
    return (
      <div className="page-shell">
        <div className="auth-panel">
          <h1>WaveTalk Kayıt</h1>
          <div className="auth-form">
            <label>Kullanıcı adı</label>
            <input value={regUsername} placeholder="Kullanıcı adınızı yazın" onChange={(e) => setRegUsername(e.target.value)} />
            <label>Parola</label>
            <input
              type="password"
              value={regPassword}
              placeholder="Parolanızı yazın"
              onChange={(e) => setRegPassword(e.target.value)}
            />
            <label>Ülke</label>
            <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)}>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name} ({country.code})
                </option>
              ))}
            </select>
            <label>Numara</label>
            <div className="phone-picker">
              <input value={selectedPhone || availablePhone} readOnly />
              <button onClick={() => setSelectedPhone(availablePhone)}>Seç</button>
            </div>
            <label>Profil adı (isteğe bağlı)</label>
            <input value={regProfileName} placeholder="Profil adı" onChange={(e) => setRegProfileName(e.target.value)} />
            <button onClick={handleRegister}>Kayıt Ol</button>
            {registerError && <div className="error">{registerError}</div>}
            {connectionError && <div className="error">{connectionError}</div>}
            <div className="auth-switch">
              <span>Zaten hesabın var mı?</span>
              <button onClick={() => { setPage('login'); setLoginError(''); setRegisterError('') }}>Giriş Yap</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderHome = () => {
    const targetUser = serverUsers.find((user) => user.id === selectedChatUserId)
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div>
              <span className="app-logo">WaveTalk</span>
              <p>Gerçek zamanlı sohbet</p>
            </div>
            <button className="icon-button" onClick={() => setPage('home')}>☰</button>
          </div>

          <div className="quick-tabs">
            <button className="active">Sohbetler</button>
            <button>Topluluklar</button>
            <button>Aramalar</button>
          </div>

          <div className="search-row">
            <input placeholder="Ara" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>

          <div className="friend-list">
            <div className="section-header">Arkadaşlar</div>
            {filteredUsers.length ? (
              filteredUsers.map((user) => (
                <button
                  key={user.id}
                  className={`friend-item ${selectedChatUserId === user.id ? 'selected' : ''}`}
                  onClick={() => setSelectedChatUserId(user.id)}
                >
                  <div>
                    <div className="friend-name">{user.profileName || user.username}</div>
                    <div className="friend-subtitle">{user.phone} • {user.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">Yeni arkadaş eklemek için "Yeni Kişi" oluşturun.</div>
            )}
          </div>

          <div className="sidebar-footer">
            <button className="secondary-button">Yeni Grup</button>
            <button className="secondary-button">Yeni Kişi</button>
          </div>
        </aside>

        <main className="main-panel">
          <div className="topbar">
            <div>
              <h2>{currentUser?.profileName || currentUser?.username}</h2>
              <div>
                {currentUser?.phone} • {currentUser?.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'} • {connected ? 'Sunucu bağlı' : 'Sunucuya bağlanmıyor'}
              </div>
            </div>
            <div className="top-actions">
              <button className="icon-button" onClick={() => startCall('audio')} disabled={!selectedChatUserId || callState !== 'idle'}>
                📞
              </button>
              <button className="icon-button" onClick={() => startCall('video')} disabled={!selectedChatUserId || callState !== 'idle'}>
                🎥
              </button>
              <button className="icon-button">⚙</button>
            </div>
          </div>

          {callError && <div className="call-error">{callError}</div>}

          {callState !== 'idle' && (
            <div className="call-panel">
              <div className="call-info">
                <div>{callState === 'incoming' ? `Gelen ${callType === 'video' ? 'Görüntülü' : 'Sesli'} Arama: ${incomingCall?.fromName}` : `Arama durumu: ${callState}`}</div>
                {callState === 'incoming' ? (
                  <div className="call-actions">
                    <button className="primary-button" onClick={acceptCall}>Kabul Et</button>
                    <button className="secondary-button" onClick={rejectCall}>Reddet</button>
                  </div>
                ) : (
                  <div className="call-actions">
                    <button className="secondary-button" onClick={hangupCall}>Bitir</button>
                  </div>
                )}
              </div>
              <div className="video-grid">
                <video ref={localVideoRef} autoPlay muted playsInline className="video-box" />
                <video ref={remoteVideoRef} autoPlay playsInline className="video-box" />
              </div>
            </div>
          )}

          <div className="chat-panel">
            {selectedChatUserId ? (
              <>
                <div className="chat-header">
                  <div>{targetUser?.profileName || 'Sohbet'}</div>
                  <div className="chat-status">Sesli, görüntülü arama, medya</div>
                </div>
                <div className="message-list">
                  {currentMessages.map((message) => (
                    <div key={message.id} className={`message-bubble ${message.from === session?.userId ? 'sent' : 'received'}`}>
                      <div>{message.text}</div>
                      <div className="message-meta">
                        <span>{new Date(message.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{message.delivered ? '✓✓' : '✓'}</span>
                      </div>
                    </div>
                  ))}
                  {!currentMessages.length && <div className="empty-state">Mesajlaşmaya başlamak için yazın.</div>}
                </div>
                <div className="composer">
                  <input
                    value={draftMessage}
                    placeholder="Mesaj yaz..."
                    onChange={(e) => setDraftMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draftMessage.trim()) {
                        addMessage(draftMessage.trim())
                        setDraftMessage('')
                      }
                    }}
                  />
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (draftMessage.trim()) {
                        addMessage(draftMessage.trim())
                        setDraftMessage('')
                      }
                    }}
                  >
                    Gönder
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-chat">
                <h3>Bir sohbet seçin veya yeni kişi ekleyin.</h3>
              </div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-root">
      {page === 'login' && renderLogin()}
      {page === 'register' && renderRegister()}
      {page === 'home' && renderHome()}
      {page === 'home' && (
        <button className="logout-button" onClick={handleLogout}>Çıkış Yap</button>
      )}
    </div>
  )
}

export default App
