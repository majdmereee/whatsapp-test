const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

let mainWindow = null;
let tray = null;
let sock = null;
let isConnected = false;
let currentQrData = null;

// تشغيل سيرفر Express الداخلي لاستقبال طلبات الـ OTP
const serverApp = express();
serverApp.use(cors());
serverApp.use(express.json());

serverApp.post('/send-otp', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'بيانات ناقصة' });

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'واتساب غير متصل حالياً' });
  }

  try {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const message = `🍗 *مطعم فلاي تشكن*\nرمز التحقق الخاص بك هو: *[ ${code} ]*\n(لا تشارك هذا الرمز مع أحد).`;

    await sock.sendMessage(jid, { text: message });
    console.log(`[WhatsApp Gateway] Sent OTP ${code} to ${cleanPhone}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error sending OTP:', err);
    return res.status(500).json({ error: err.message });
  }
});

serverApp.listen(3000, () => {
  console.log('Gateway Server running on http://localhost:3000');
});

// بدء اتصال Baileys بواتساب
async function startWhatsAppSession() {
  const authPath = path.join(app.getPath('userData'), 'baileys_auth');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQrData = await QRCode.toDataURL(qr);
      if (mainWindow) {
        mainWindow.webContents.send('qr-code', currentQrData);
      }
    }

    if (connection === 'close') {
      isConnected = false;
      if (mainWindow) mainWindow.webContents.send('status-update', 'disconnected');
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(startWhatsAppSession, 3000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQrData = null;
      if (mainWindow) {
        mainWindow.webContents.send('status-update', 'connected');
      }
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide(); // الإخفاء في الخلفية بجانب الساعة
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (isConnected) {
      mainWindow.webContents.send('status-update', 'connected');
    } else if (currentQrData) {
      mainWindow.webContents.send('qr-code', currentQrData);
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png')); // أو أيقونة افتراضية
  const contextMenu = Menu.buildFromTemplate([
    { label: 'فتح اللوحة', click: () => mainWindow.show() },
    { label: 'إغلاق البرنامج نهائياً', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Fly Chicken WhatsApp Gateway');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

app.whenReady().then(() => {
  // تفعيل التشغيل التلقائي مع إقلاع ويندوز
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  });

  createWindow();
  try { createTray(); } catch(e){}
  startWhatsAppSession();
});
