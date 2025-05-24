const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const BOT_NUMBER = '6288228995716';
const ALLOWED_USER = '628895239226';
const PAIRING_CODE_ALIAS = 'SUTXTMFN';

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
    exec(command, { cwd, shell: true, timeout: 600000 }, (error, stdout, stderr) => {
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
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, isNewLogin } = update;
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        startBot();
      } else {
        console.log('Logged out. Delete auth folder and restart.');
      }
    } else if (connection === 'open') {
      console.log('Bot connected.');
      if (isNewLogin && !isPaired) {
        const code = await sock.requestPairingCode(BOT_NUMBER, PAIRING_CODE_ALIAS);
        console.log('PAIRING CODE:', code);
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), `Masukkan kode pairing: ${code}`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || !messages.length) return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const userId = jid.split('@')[0];
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (userId !== BOT_NUMBER && userId !== ALLOWED_USER) {
      await sendMessage(sock, jid, 'Maaf, kamu tidak diizinkan menggunakan bot ini.');
      return;
    }

    if (!isPaired && userId === BOT_NUMBER) {
      if (text.trim() === PAIRING_CODE_ALIAS) {
        isPaired = true;
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Pairing sukses. Bot aktif.');
        await sendMessage(sock, sanitizeJid(ALLOWED_USER), 'Bot sudah dipairing dan siap digunakan.');
      } else {
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Kode pairing salah. Masukkan "SUTXTMFN".');
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
