/**
 * TalkChat PR #43 Backend Route & Socket Əlavələri
 * Qeyd: Mövcud server.js faylındakı Express app, io və verilənlər bazası strukturuna inteqrasiya olunur.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const OWNER_USERNAMES = ['devqrxyz', 'aqil kerimov', 'aqil kərimov'];

function isOwnerUser(user) {
  if (!user) return false;
  if (user.isOwner === true || user.role === 'owner') return true;
  const uname = String(user.username || '').trim().toLowerCase();
  const fullName = String(user.fullName || user.name || '').trim().toLowerCase();
  return OWNER_USERNAMES.includes(uname) || OWNER_USERNAMES.includes(fullName);
}

function requireOwner(req, res, next) {
  if (!req.user || !isOwnerUser(req.user)) {
    return res.status(403).json({ error: 'Bu əməliyyat yalnız layihə sahibi (Owner) üçündür.' });
  }
  next();
}

// Təhlükəsiz audio və üz qabığı yükləmə konfiqurasiyası
const SONGS_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'songs');
fs.mkdirSync(SONGS_UPLOAD_DIR, { recursive: true });

const songStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SONGS_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, safeName);
  }
});

const ALLOWED_AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac']);
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const uploadSongMiddleware = multer({
  storage: songStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'audio' && ALLOWED_AUDIO_MIMES.has(file.mimetype)) return cb(null, true);
    if (file.fieldname === 'cover' && ALLOWED_IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Dəstəklənməyən fayl formatı'));
  }
});

function registerTalkChatPR43Features(app, io, db) {
  // 1. Bütün istifadəçilər üçün server mahnıları siyahısı və axtarış
  app.get('/api/songs', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      let songs = await db.getSongs(); // Mövcud DB adapter metodu
      if (q) {
        songs = songs.filter(
          (s) =>
            (s.title && s.title.toLowerCase().includes(q)) ||
            (s.artist && s.artist.toLowerCase().includes(q)) ||
            (s.album && s.album.toLowerCase().includes(q))
        );
      }
      res.json({ songs, canManage: isOwnerUser(req.user) });
    } catch (err) {
      res.status(500).json({ error: 'Mahnılar yüklənərkən xəta baş verdi' });
    }
  });

  // 2. Owner üçün yeni mahnı yükləmə
  app.post(
    '/api/admin/songs',
    requireOwner,
    uploadSongMiddleware.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
    async (req, res) => {
      try {
        const audioFile = req.files && req.files.audio && req.files.audio[0];
        if (!audioFile) {
          return res.status(400).json({ error: 'Audio faylı mütləqdir' });
        }
        const coverFile = req.files && req.files.cover && req.files.cover[0];
        const title = String(req.body.title || path.parse(audioFile.originalname).name).trim().slice(0, 120);
        const artist = String(req.body.artist || 'Naməlum ifaçı').trim().slice(0, 120);
        const album = String(req.body.album || 'Single').trim().slice(0, 120);

        const song = await db.createSong({
          id: crypto.randomUUID(),
          title,
          artist,
          album,
          audioUrl: `/uploads/songs/${audioFile.filename}`,
          coverUrl: coverFile ? `/uploads/songs/${coverFile.filename}` : '/assets/default-cover.png',
          uploadedBy: req.user.id,
          createdAt: new Date().toISOString()
        });

        res.status(201).json({ song });
      } catch (err) {
        res.status(500).json({ error: 'Mahnı yadda saxlanılmadı' });
      }
    }
  );

  // 3. Owner üçün mahnı redaktəsi və silinməsi
  app.put('/api/admin/songs/:id', requireOwner, async (req, res) => {
    const updated = await db.updateSong(req.params.id, {
      title: String(req.body.title || '').trim().slice(0, 120),
      artist: String(req.body.artist || '').trim().slice(0, 120),
      album: String(req.body.album || '').trim().slice(0, 120)
    });
    if (!updated) return res.status(404).json({ error: 'Mahnı tapılmadı' });
    res.json({ song: updated });
  });

  app.delete('/api/admin/songs/:id', requireOwner, async (req, res) => {
    const song = await db.getSongById(req.params.id);
    if (!song) return res.status(404).json({ error: 'Mahnı tapılmadı' });
    if (song.audioUrl && song.audioUrl.startsWith('/uploads/songs/')) {
      const target = path.join(__dirname, 'public', song.audioUrl);
      if (target.startsWith(SONGS_UPLOAD_DIR) && fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
    await db.deleteSong(req.params.id);
    res.json({ deleted: true });
  });

  // 4. TalkStore Profil Çərçivəsi və Emoji Paketləri
  app.post('/api/store/frame/select', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş tələb olunur' });
    const { frameId } = req.body; // null olduqda çərçivə silinir
    await db.updateUserFrame(req.user.id, frameId || null);
    res.json({ activeFrame: frameId || null });
  });

  app.post('/api/store/emoji-pack/toggle', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Giriş tələb olunur' });
    const { packId, active } = req.body;
    const updatedPacks = await db.toggleUserEmojiPack(req.user.id, packId, Boolean(active));
    res.json({ activeEmojiPacks: updatedPacks });
  });

  // 5. WebRTC Zəng Sessiyası və ICE Candidate Növbə İdarəetməsi
  const activeCalls = new Map();

  io.on('connection', (socket) => {
    socket.on('call:offer', ({ callId, toUserId, offer, mediaType }) => {
      if (!callId || activeCalls.has(callId)) return; // Təkrar bildirişin qarşısı
      activeCalls.set(callId, {
        callId,
        callerSocket: socket.id,
        calleeId: toUserId,
        status: 'ringing',
        createdAt: Date.now()
      });
      io.to(`user:${toUserId}`).emit('call:incoming', { callId, fromSocket: socket.id, offer, mediaType });
    });

    socket.on('call:answer', ({ callId, answer }) => {
      const session = activeCalls.get(callId);
      if (!session || session.status !== 'ringing') return;
      session.status = 'connected';
      session.calleeSocket = socket.id;
      io.to(session.callerSocket).emit('call:answered', { callId, answer });
    });

    socket.on('call:ice-candidate', ({ callId, candidate, targetSocket }) => {
      if (!activeCalls.has(callId) || !candidate) return;
      io.to(targetSocket).emit('call:ice-candidate', { callId, candidate });
    });

    socket.on('call:end', ({ callId, reason }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      activeCalls.delete(callId);
      if (session.callerSocket) io.to(session.callerSocket).emit('call:ended', { callId, reason });
      if (session.calleeSocket) io.to(session.calleeSocket).emit('call:ended', { callId, reason });
    });

    socket.on('disconnect', () => {
      for (const [callId, session] of activeCalls.entries()) {
        if (session.callerSocket === socket.id || session.calleeSocket === socket.id) {
          activeCalls.delete(callId);
          const peer = session.callerSocket === socket.id ? session.calleeSocket : session.callerSocket;
          if (peer) io.to(peer).emit('call:ended', { callId, reason: 'disconnected' });
        }
      }
    });
  });
}

module.exports = { registerTalkChatPR43Features, isOwnerUser, requireOwner };
