const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const { Boom } = require('@hapi/boom');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

const BOT_NUMBER = '6288228995716'; // nomor bot (harus lengkap tanpa +)
const ALLOWED_USER = '628895239226'; // nomor user yang diizinkan
const PAIRING_CODE = 'SUTX-TMFN';

let isPaired = false;

const userDirs = {}; // direktori kerja tiap user

async function sendMessage(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

function sanitizeJid(number) {
  return number.includes('@s.whatsapp.net') ? number : number + '@s.whatsapp.net';
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
  // Kirim output dibagi tiap 4000 karakter
  for (let i = 0; i < output.length; i += 4000) {
    await sendMessage(sock, jid, output.slice(i, i + 4000));
  }
}

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false // jangan pakai QR
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        startBot();
      } else {
        console.log('Logged out. Please remove auth_info.json and restart.');
      }
    } else if (connection === 'open') {
      console.log('Bot connected');
      if (!isPaired) {
        // Kirim notif pairing ke nomor bot
        sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Bot belum dipairing. Kirim kode pairing 8 digit "SUTX-TMFN" untuk mengaktifkan akses.');
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

    // Batasi akses hanya untuk nomor bot & user yang diizinkan
    if (userId !== BOT_NUMBER && userId !== ALLOWED_USER) {
      await sendMessage(sock, jid, 'Maaf, kamu tidak diizinkan mengakses bot ini.');
      return;
    }

    // Jika pesan dari nomor bot & belum paired, cek pairing code
    if (userId === BOT_NUMBER && !isPaired) {
      if (text.trim() === PAIRING_CODE) {
        isPaired = true;
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Pairing berhasil! Bot siap digunakan.');
        await sendMessage(sock, sanitizeJid(ALLOWED_USER), 'Bot sudah dipairing dan siap digunakan.');
      } else {
        await sendMessage(sock, sanitizeJid(BOT_NUMBER), 'Kode pairing salah. Kirim ulang kode yang benar: "SUTX-TMFN"');
      }
      return;
    }

    // Jika belum paired, user belum bisa akses
    if (!isPaired && userId === ALLOWED_USER) {
      await sendMessage(sock, jid, 'Bot belum dipairing. Tunggu sampai pairing selesai oleh nomor bot.');
      return;
    }

    // Setelah paired, eksekusi perintah shell
    await handleCommand(sock, jid, userId, text);
  });
}

startBot().catch(console.error);
