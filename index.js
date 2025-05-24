const {
  default: makeWASocket,
  useSingleFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

const BOT_NUMBER = '6288228995716';
const ALLOWED_USER = '628895239226';
const PAIRING_CODE = 'SUTXTMFN';
let isPaired = false;

const userDirs = {};

function sanitizeJid(number) {
  return number.includes('@s.whatsapp.net') ? number : number + '@s.whatsapp.net';
}

async function sendMessage(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

async function execShellCommand(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, shell: true, timeout: 600000 }, (err, stdout, stderr) => {
      let output = (stdout || '') + (stderr || '');
      if (!output.trim()) output = 'root@stxtamfan:~#';
      resolve(output.trim());
    });
  });
}

async function handleCommand(sock, jid, userId, text) {
  if (!(userId in userDirs)) {
    userDirs[userId] = os.homedir();
  }

  let currentDir = userDirs[userId];
  const command = text.trim();

  if (command.startsWith('cd ')) {
    const targetPath = command.slice(3).trim();
    const newDir = path.resolve(currentDir, targetPath);
    if (fs.existsSync(newDir) && fs.statSync(newDir).isDirectory()) {
      userDirs[userId] = newDir;
      await sendMessage(sock, jid, `root@stxtamfan:~${newDir}#`);
    } else {
      await sendMessage(sock, jid, `No such directory: ${newDir}`);
    }
    return;
  }

  const output = await execShellCommand(command, currentDir);
  for (let i = 0; i < output.length; i += 4000) {
    await sendMessage(sock, jid, output.slice(i, i + 4000));
  }
}

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveState);

  // Request custom pairing code jika belum login
  if (!fs.existsSync('./auth_info.json')) {
    try {
      const code = await sock.requestPairingCode(BOT_NUMBER, PAIRING_CODE);
      console.log('Kode pairing berhasil dibuat:', code);
      await sendMessage(sock, sanitizeJid(BOT_NUMBER), `Masukkan pairing code ini di WA Desktop: ${code}`);
    } catch (err) {
      console.error('Gagal membuat pairing code:', err);
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        startBot();
      } else {
        console.log('Logged out. Remove auth_info.json and restart.');
      }
    } else if (connection === 'open') {
      console.log('Bot connected');
      if (!isPaired) {
        sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Bot belum dipairing. Masukkan kode pairing: "SUTXTMFN"');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || messages.length === 0) return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const userId = jid.split('@')[0];
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (userId !== BOT_NUMBER && userId !== ALLOWED_USER) {
      await sendMessage(sock, jid, 'Akses ditolak.');
      return;
    }

    if (userId === BOT_NUMBER && !isPaired) {
      if (text.trim() === PAIRING_CODE) {
        isPaired = true;
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Pairing berhasil! Bot siap digunakan.');
        await sendMessage(sock, sanitizeJid(ALLOWED_USER), 'Bot sudah dipairing dan siap digunakan.');
      } else {
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Kode pairing salah. Gunakan kode: "SUTXTMFN"');
      }
      return;
    }

    if (!isPaired && userId === ALLOWED_USER) {
      await sendMessage(sock, jid, 'Bot belum dipairing. Tunggu pairing dari nomor bot.');
      return;
    }

    await handleCommand(sock, jid, userId, text);
  });
}

startBot().catch(console.error);
