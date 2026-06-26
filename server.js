const express = require('express')
const http = require('http')
const path = require('path')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const distPath = path.join(__dirname, 'dist')
const io = new Server(server, {
  cors: {
    origin: '*',
  },
})

const defaultUsers = [
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

const users = [...defaultUsers]
const messages = []
const sessions = {}
const socketByUser = {}

const createToken = () => Math.random().toString(36).slice(2) + Date.now()

const findUser = ({ username, password, phone }) =>
  users.find((user) => user.username === username && user.password === password && user.phone === phone)

const isUsernameUsed = (username) => users.some((user) => user.username === username)
const isPasswordUsed = (password) => users.some((user) => user.password === password)
const isPhoneUsed = (phone) => users.some((user) => user.phone === phone)

const broadcastState = () => {
  io.emit('state_update', {
    users,
    messages,
  })
}

const setOffline = (userId) => {
  const user = users.find((item) => item.id === userId)
  if (user) {
    user.isOnline = false
    user.lastSeen = new Date().toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
  }
}

const forwardToUser = (userId, event, payload) => {
  const socketId = socketByUser[userId]
  if (!socketId) return
  const targetSocket = io.sockets.sockets.get(socketId)
  if (!targetSocket) return
  targetSocket.emit(event, payload)
}

io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id)

  socket.on('resume_session', (session) => {
    const stored = sessions[session?.token]
    if (stored && stored.userId === session.userId) {
      socket.data.userId = session.userId
      socketByUser[session.userId] = socket.id
      const user = users.find((item) => item.id === session.userId)
      if (user) {
        user.isOnline = true
        user.lastSeen = 'Şimdi'
        socket.emit('login_success', { session })
        broadcastState()
      }
    }
  })

  socket.on('login', ({ username, password, phone }) => {
    const user = findUser({ username, password, phone })
    if (!user) {
      socket.emit('login_error', 'Kullanıcı adı, parola veya numara yanlış.')
      return
    }
    const token = createToken()
    sessions[token] = { userId: user.id }
    socket.data.userId = user.id
    socketByUser[user.id] = socket.id
    user.isOnline = true
    user.lastSeen = 'Şimdi'
    socket.emit('login_success', { session: { userId: user.id, token } })
    broadcastState()
  })

  socket.on('register', ({ username, password, country, phone, profileName }) => {
    if (isUsernameUsed(username)) {
      socket.emit('register_error', 'Bu kullanıcı adı zaten kullanılıyor.')
      return
    }
    if (isPasswordUsed(password)) {
      socket.emit('register_error', 'Bu parola zaten kullanılıyor.')
      return
    }
    if (isPhoneUsed(phone)) {
      socket.emit('register_error', 'Bu telefon numarası zaten kullanılıyor.')
      return
    }

    const newUser = {
      id: `u${Date.now()}`,
      username,
      password,
      phone,
      country,
      profileName: profileName || username,
      avatar: '',
      isOnline: true,
      verified: false,
      blocked: false,
      banned: false,
      bannedReason: null,
      lastSeen: 'Şimdi',
      primeBalance: 0,
      pulseBalance: 0,
    }
    users.push(newUser)
    const token = createToken()
    sessions[token] = { userId: newUser.id }
    socket.data.userId = newUser.id
    socketByUser[newUser.id] = socket.id
    socket.emit('register_success', { session: { userId: newUser.id, token } })
    broadcastState()
  })

  socket.on('send_message', ({ from, to, text }) => {
    const message = {
      id: `m${Date.now()}`,
      from,
      to,
      text,
      createdAt: new Date().toISOString(),
      delivered: true,
      read: false,
    }
    messages.push(message)
    io.emit('message_received', message)
    broadcastState()
  })

  socket.on('call_user', ({ from, to, offer, type, fromName }) => {
    forwardToUser(to, 'incoming_call', { from, offer, type, fromName })
  })

  socket.on('call_answer', ({ from, to, answer }) => {
    forwardToUser(to, 'call_answer', { from, answer })
  })

  socket.on('ice_candidate', ({ from, to, candidate }) => {
    forwardToUser(to, 'ice_candidate', { from, candidate })
  })

  socket.on('end_call', ({ from, to }) => {
    forwardToUser(to, 'call_ended', { from })
  })

  socket.on('reject_call', ({ from, to }) => {
    forwardToUser(to, 'call_rejected', { from })
  })

  socket.on('logout', () => {
    const userId = socket.data.userId
    if (userId) {
      setOffline(userId)
      delete socketByUser[userId]
      socket.data.userId = null
      broadcastState()
    }
  })

  socket.on('disconnect', () => {
    const userId = socket.data.userId
    if (userId) {
      setOffline(userId)
      delete socketByUser[userId]
      broadcastState()
    }
  })
})

app.use(express.static(distPath))

app.get('/health', (req, res) => {
  res.send('NEUXUS Socket.io server çalışıyor')
})

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

const port = process.env.PORT || 3001
server.listen(port, () => {
  console.log(`Socket server çalışıyor: http://localhost:${port}`)
})
