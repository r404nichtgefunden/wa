const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require('baileys')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const P = require('pino')

const userDirs = {}
let allowedUsers = new Set(['628895239226@s.whatsapp.net'])
let botJid = null

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: ['MyBot', 'Safari', '1.0']
  })

  // Tampilkan kode pairing di console
  if (!sock.authState.creds.registered) {
    console.log("=== BOT BELUM TERDAFTAR ===")
    const phoneNumber = '62xxxxxx' // ganti dengan nomor WA kamu (format tanpa +)
    await sock.requestPairingCode(phoneNumber).then(code => {
      console.log(`Kode Pairing (6 digit): ${code}`)
    }).catch(console.error)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection } = update
    if (connection === 'open') {
      botJid = sock.user.id
      allowedUsers.add(botJid)
      console.log(`Bot terhubung sebagai ${botJid}`)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const sender = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text
    if (!text) return

    if (!allowedUsers.has(sender)) {
      await sock.sendMessage(sender, { text: 'Unauthorized access. You are not allowed to use this bot.' })
      return
    }

    if (text.startsWith('/adduser')) {
      const parts = text.split(' ')
      if (parts.length === 2) {
        const newUser = parts[1].replace(/\D/g, '') + '@s.whatsapp.net'
        allowedUsers.add(newUser)
        await sock.sendMessage(sender, { text: `User ${newUser} added.` })
      } else {
        await sock.sendMessage(sender, { text: 'Usage: /adduser 628xxxxxx' })
      }
      return
    }

    if (!userDirs[sender]) userDirs[sender] = process.cwd()
    let currentDir = userDirs[sender]

    if (text === '/start') {
      await sock.sendMessage(sender, {
        text: 'Bot aktif. Kirim perintah shell.\nFolder kerja default: /workspace/code/\n\nContoh:\ncd /workspace/code/\nls'
      })
      return
    }

    if (text.startsWith('cd ')) {
      const targetPath = path.resolve(currentDir, text.slice(3).trim())
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        userDirs[sender] = targetPath
        await sock.sendMessage(sender, { text: `root@stxtamfan:~${targetPath}#` })
      } else {
        await sock.sendMessage(sender, { text: `No such directory: ${targetPath}` })
      }
      return
    }

    exec(text, { cwd: currentDir, timeout: 600000 }, async (err, stdout, stderr) => {
      let output = stdout + stderr
      if (err) output += `\n${err.message}`
      output = output.trim() || "root@stxtamfan:~#"

      const chunks = output.match(/[\s\S]{1,4000}/g) || []
      for (const chunk of chunks) {
        await sock.sendMessage(sender, { text: chunk })
      }
    })
  })
}

startBot()
