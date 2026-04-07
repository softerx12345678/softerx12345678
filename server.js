// ============================================
// StandoffX Game Server — для деплою на Render
// ============================================
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// --- ФАЙЛОВА БАЗА ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(path.join(__dirname, 'avatars'))) fs.mkdirSync(path.join(__dirname, 'avatars'));

const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');
const CLANS_PATH = path.join(DATA_DIR, 'clans.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');

function readJSON(filePath, defaultVal) {
  try {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2));
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultVal; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUsers() { return readJSON(ACCOUNTS_PATH, []); }
function saveUsers(u) { writeJSON(ACCOUNTS_PATH, u); }
function getClans() { return readJSON(CLANS_PATH, {}); }
function saveClans(c) { writeJSON(CLANS_PATH, c); }
function getMessages() { return readJSON(MESSAGES_PATH, {}); }
function saveMessages(m) { writeJSON(MESSAGES_PATH, m); }

// --- MIDDLEWARE ---
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use('/avatars', express.static(path.join(__dirname, 'avatars')));

// ==========================================
// AUTH API
// ==========================================
app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ success: false, message: 'Заповніть всі поля!' });

  const users = getUsers();
  const search = nickname.trim().toLowerCase();
  const user = users.find(u =>
    (u.id.toLowerCase() === search || u.nickname.toLowerCase() === search) && u.password === password
  );

  if (!user) return res.status(401).json({ success: false, message: 'Невірний логін або пароль!' });
  if (user.isBanned) return res.status(403).json({ success: false, message: 'Акаунт заблоковано!' });

  // Ставимо online
  user.status = 'online';
  saveUsers(users);

  const { password: _, ...userData } = user;
  res.json({ success: true, user: userData });
});

app.post('/api/register', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password || nickname.length < 3) {
    return res.status(400).json({ success: false, message: 'Нік мінімум 3 символи!' });
  }

  let users = getUsers();
  if (users.find(u => u.nickname.toLowerCase() === nickname.toLowerCase())) {
    return res.status(409).json({ success: false, message: 'Нік вже зайнято!' });
  }

  const newUser = {
    uuid: crypto.randomUUID(),
    nickname,
    password,
    id: nickname,
    playerAvatar: '/avatars/default_avatar.jpg',
    status: 'online',
    XP: 0,
    gold: 0,
    clan: null,
    MMRCompetitive: 1000,
    MMRAllies: 1000,
    isVerified: false,
    isBanned: false,
    isAdmin: false,
    friendsList: [],
    incomingRequests: [],
    blocked: [],
  };

  users.push(newUser);
  saveUsers(users);

  const { password: _, ...userData } = newUser;
  res.json({ success: true, user: userData });
});

// ==========================================
// USER DATA
// ==========================================
app.get('/api/user-data', (req, res) => {
  const uuid = req.query.uuid;
  if (!uuid) return res.status(400).json({ success: false });

  const users = getUsers();
  const user = users.find(u => u.uuid === uuid);
  if (!user) return res.status(404).json({ success: false, message: 'Не знайдено' });

  const friendsData = (user.friendsList || []).map(fId => {
    const f = users.find(u => u.id === fId);
    return f ? { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar, status: f.status, isVerified: f.isVerified } : null;
  }).filter(Boolean);

  const { password: _, ...userData } = user;
  res.json({ success: true, user: userData, friends: friendsData });
});

app.post('/api/change-nickname', (req, res) => {
  const { uuid, newNick } = req.body;
  if (!newNick || newNick.length < 3) return res.json({ success: false, message: 'Мін. 3 символи' });

  let users = getUsers();
  const user = users.find(u => u.uuid === uuid);
  if (!user) return res.json({ success: false });

  user.nickname = newNick;
  saveUsers(users);
  res.json({ success: true, newNick });
});

// ==========================================
// FRIENDS
// ==========================================
app.get('/api/get-friends', (req, res) => {
  const userId = req.query.userId;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ success: false });

  const friends = (user.friendsList || []).map(fId => {
    const f = users.find(u => u.id === fId);
    return f ? { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar, status: f.status, isVerified: f.isVerified } : null;
  }).filter(Boolean);

  res.json({ success: true, friends });
});

app.post('/api/search-user', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false });

  const users = getUsers();
  const q = query.trim().toLowerCase();
  const user = users.find(u => u.nickname.toLowerCase() === q || u.id.toLowerCase() === q);

  if (user) {
    res.json({ success: true, user: { nickname: user.nickname, id: user.id, playerAvatar: user.playerAvatar, isVerified: user.isVerified, status: user.status } });
  } else {
    res.json({ success: false, message: 'Не знайдено' });
  }
});

app.post('/api/friends/add', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const target = users.find(u => u.id === friendId);
  if (!target) return res.json({ success: false, message: 'Не знайдено' });

  if (!target.incomingRequests) target.incomingRequests = [];
  if (target.incomingRequests.includes(myId)) return res.json({ success: false, message: 'Запит вже надіслано' });

  target.incomingRequests.push(myId);
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/friends/accept', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === myId);
  const friend = users.find(u => u.id === friendId);
  if (!user || !friend) return res.json({ success: false });

  user.friendsList = user.friendsList || [];
  friend.friendsList = friend.friendsList || [];
  if (!user.friendsList.includes(friendId)) user.friendsList.push(friendId);
  if (!friend.friendsList.includes(myId)) friend.friendsList.push(myId);

  user.incomingRequests = (user.incomingRequests || []).filter(id => id !== friendId);
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/friends/decline', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === myId);
  if (!user) return res.json({ success: false });

  user.incomingRequests = (user.incomingRequests || []).filter(id => id !== friendId);
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/friends/remove', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === myId);
  const friend = users.find(u => u.id === friendId);
  if (!user || !friend) return res.json({ success: false });

  user.friendsList = (user.friendsList || []).filter(id => id !== friendId);
  friend.friendsList = (friend.friendsList || []).filter(id => id !== myId);
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/friends/block', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === myId);
  if (!user) return res.json({ success: false });

  user.blocked = user.blocked || [];
  if (!user.blocked.includes(friendId)) user.blocked.push(friendId);
  user.friendsList = (user.friendsList || []).filter(id => id !== friendId);
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/friends/unblock', (req, res) => {
  const { myId, friendId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === myId);
  if (!user) return res.json({ success: false });

  user.blocked = (user.blocked || []).filter(id => id !== friendId);
  saveUsers(users);
  res.json({ success: true });
});

app.get('/api/friends/requests', (req, res) => {
  const userId = req.query.userId;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ success: false });

  const requests = (user.incomingRequests || []).map(fId => {
    const f = users.find(u => u.id === fId);
    return f ? { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar } : null;
  }).filter(Boolean);

  res.json({ success: true, requests });
});

app.get('/api/friends/blocked', (req, res) => {
  const userId = req.query.userId;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ success: false });

  const blocked = (user.blocked || []).map(fId => {
    const f = users.find(u => u.id === fId);
    return f ? { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar } : null;
  }).filter(Boolean);

  res.json({ success: true, blocked });
});

// ==========================================
// CLANS
// ==========================================
app.get('/api/clans', (req, res) => {
  const clans = getClans();
  res.json({ clans: Object.values(clans) });
});

app.get('/api/get-clan', (req, res) => {
  const clanId = req.query.clanId;
  const clans = getClans();
  const clan = clans[clanId] || Object.values(clans).find(c => c.id === clanId || c.tag === clanId);
  if (!clan) return res.status(404).json({ success: false });

  const users = getUsers();
  const members = users.filter(u => u.clan === clan.tag || u.clan === clanId).map(u => ({
    id: u.id, nickname: u.nickname, role: u.clanRole || 'member', status: u.status, playerAvatar: u.playerAvatar
  }));

  res.json({ success: true, clan, members });
});

app.post('/api/clans/create', (req, res) => {
  const { userId, name, tag } = req.body;
  if (!name || !tag || tag.length > 5) return res.json({ success: false, message: 'Тег макс. 5 символів' });

  let clans = getClans();
  if (clans[tag]) return res.json({ success: false, message: 'Тег зайнято' });

  let users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ success: false });
  if (user.clan) return res.json({ success: false, message: 'Ви вже в клані' });

  clans[tag] = { id: crypto.randomUUID(), name, tag, ownerId: userId, requests: [], createdAt: new Date().toISOString() };
  user.clan = tag;
  user.clanRole = 'leader';

  saveClans(clans);
  saveUsers(users);
  res.json({ success: true, clan: clans[tag] });
});

app.post('/api/clans/request', (req, res) => {
  const { userId, clanTag } = req.body;
  let clans = getClans();
  const clan = clans[clanTag];
  if (!clan) return res.json({ success: false, message: 'Клан не знайдено' });

  if (!clan.requests) clan.requests = [];
  if (clan.requests.find(r => r.userId === userId)) return res.json({ success: false, message: 'Заявка вже є' });

  clan.requests.push({ id: Date.now().toString(), userId, status: 'pending' });
  saveClans(clans);
  res.json({ success: true });
});

app.post('/api/clans/accept', (req, res) => {
  const { requestId, clanTag } = req.body;
  let clans = getClans();
  let users = getUsers();
  const clan = clans[clanTag];
  if (!clan || !clan.requests) return res.json({ success: false });

  const reqIdx = clan.requests.findIndex(r => r.id === requestId);
  if (reqIdx === -1) return res.json({ success: false });

  const targetId = clan.requests[reqIdx].userId;
  const target = users.find(u => u.id === targetId);
  if (target) { target.clan = clanTag; target.clanRole = 'member'; saveUsers(users); }

  clan.requests.splice(reqIdx, 1);
  saveClans(clans);
  res.json({ success: true });
});

app.post('/api/clans/leave', (req, res) => {
  const { userId } = req.body;
  let users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user || !user.clan) return res.json({ success: false });

  user.clan = null;
  user.clanRole = undefined;
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/clans/requests', (req, res) => {
  const { userId } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user || !user.clan) return res.json({ success: false });

  const clans = getClans();
  const clan = clans[user.clan];
  if (!clan) return res.json({ success: false });

  const pending = (clan.requests || []).filter(r => r.status === 'pending');
  // Enrich with user data
  const enriched = pending.map(r => {
    const u = users.find(u2 => u2.id === r.userId);
    return { ...r, nickname: u?.nickname, playerAvatar: u?.playerAvatar };
  });

  res.json({ success: true, requests: enriched });
});

// ==========================================
// MESSAGES (REST fallback — Socket.IO is primary)
// ==========================================
app.post('/api/send-message', (req, res) => {
  const { fromId, toId, text } = req.body;
  const users = getUsers();
  const sender = users.find(u => u.id === fromId);
  if (!sender) return res.status(404).json({ success: false });

  const roomId = [fromId, toId].sort().join('_');
  let msgs = getMessages();
  if (!msgs[roomId]) msgs[roomId] = [];

  const msgData = { senderId: fromId, senderName: sender.nickname, text, time: new Date().toISOString() };
  msgs[roomId].push(msgData);
  saveMessages(msgs);

  res.json({ success: true, message: msgData });
});

app.get('/api/messages', (req, res) => {
  const { user1, user2 } = req.query;
  const roomId = [user1, user2].sort().join('_');
  const msgs = getMessages();
  res.json({ success: true, messages: msgs[roomId] || [] });
});

// ==========================================
// MATCHMAKING (in-memory)
// ==========================================
let activeMatches = {};
let matchmakingQueue = [];

const weaponDamage = {
  '1': { head: 50, body: 25, legs: 15 },
  '2': { head: 80, body: 40, legs: 25 },
  '3': { head: 40, body: 20, legs: 10 },
  '4': { head: 100, body: 35, legs: 20 },
  '5': { head: 100, body: 80, legs: 40 },
  '6': { head: 200, body: 150, legs: 85 },
};

const SPAWN_POINTS = [
  { x: 0, y: 1, z: 0 },
  { x: 10, y: 1, z: 0 },
  { x: -10, y: 1, z: 0 },
  { x: 0, y: 1, z: 10 },
];

// ==========================================
// SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log(`[SOCKET] Підключено: ${socket.id}`);

  // --- Авторизація сокета ---
  socket.on('auth', (data) => {
    socket.userId = data.userId;
    socket.nickname = data.nickname;
    console.log(`[AUTH] ${data.nickname} (${data.userId})`);
  });

  // --- Пошук матчу ---
  socket.on('find_match', (data) => {
    const { userId, nickname, mode } = data;
    console.log(`[QUEUE] ${nickname} шукає матч (mode: ${mode})`);

    matchmakingQueue.push({ socketId: socket.id, userId, nickname, mode: mode || 1 });

    // Перевіряємо чергу для конкретного режиму
    const modeQueue = matchmakingQueue.filter(p => p.mode === (mode || 1));

    const requiredPlayers = mode === 3 ? 2 : 2; // Мінімум 2 для старту

    if (modeQueue.length >= requiredPlayers) {
      const players = modeQueue.splice(0, requiredPlayers);
      matchmakingQueue = matchmakingQueue.filter(p => !players.find(pl => pl.socketId === p.socketId));

      const matchId = 'match_' + Date.now();
      activeMatches[matchId] = {
        id: matchId,
        mode: mode || 1,
        players: players.map((p, i) => ({
          socketId: p.socketId,
          userId: p.userId,
          nickname: p.nickname,
          kills: 0,
          deaths: 0,
          hp: 100,
          spawnPos: SPAWN_POINTS[i % SPAWN_POINTS.length],
          role: mode === 3 ? (i === 0 ? 'hunter' : 'runner') : 'fighter',
        })),
        isStarted: false,
      };

      players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) {
          s.join(matchId);
          s.emit('match_found', { matchId, mode: mode || 1 });
        }
      });

      console.log(`[MATCH] Створено ${matchId} з ${players.length} гравцями`);
    }
  });

  socket.on('cancel_search', () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
  });

  // --- Ігрова кімната ---
  socket.on('join_room', (data) => {
    const match = activeMatches[data.matchId];
    if (!match) return socket.emit('kick_to_menu', { reason: 'Матч не знайдено' });

    const player = match.players.find(p => String(p.userId) === String(data.userId));
    if (!player) return socket.emit('kick_to_menu');

    player.socketId = socket.id;
    socket.join(data.matchId);

    socket.emit('init_player', { role: player.role, spawn: player.spawnPos, nickname: player.nickname });

    io.to(data.matchId).emit('update_score', match.players.map(p => ({
      userId: p.userId, nickname: p.nickname, kills: p.kills, hp: p.hp
    })));

    if (!match.isStarted) {
      match.isStarted = true;
      runMatchLifecycle(data.matchId);
    }
  });

  // --- Рух гравця ---
  socket.on('player_moved', (data) => {
    const match = activeMatches[data.matchId];
    if (!match) return;
    const player = match.players.find(p => p.userId === data.userId);
    if (!player) return;

    player.pos = { x: data.x, y: data.y, z: data.z };

    socket.to(data.matchId).emit('enemy_moved', {
      userId: player.userId,
      nickname: player.nickname,
      x: data.x, y: data.y, z: data.z,
      rotY: data.rotY,
      rotX: data.rotX,
      weapon: data.weapon,
      isCrouching: data.isCrouching,
    });
  });

  // --- Стрільба ---
  socket.on('player_shoot', (data) => {
    const match = activeMatches[data.matchId];
    if (!match) return;

    const shooter = match.players.find(p => p.userId === data.shooterId);
    const target = match.players.find(p => p.userId === data.targetId);
    if (!shooter || !target) return;

    const dmg = weaponDamage[data.weaponId] || weaponDamage['1'];
    const damage = dmg[data.hitZone] || dmg.body;

    target.hp -= damage;
    io.to(data.matchId).emit('player_hit', { targetId: target.userId, damage, hp: target.hp });

    if (target.hp <= 0) {
      shooter.kills++;
      target.deaths++;
      target.hp = 100;

      io.to(data.matchId).emit('player_killed', {
        killerId: shooter.userId, killerName: shooter.nickname,
        victimId: target.userId, victimName: target.nickname
      });

      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        setTimeout(() => {
          targetSocket.emit('respawn', target.spawnPos);
        }, 3000);
      }

      io.to(data.matchId).emit('update_score', match.players.map(p => ({
        userId: p.userId, nickname: p.nickname, kills: p.kills, hp: p.hp
      })));
    }
  });

  // --- Чат через сокети ---
  socket.on('join_chat', ({ userId, friendId }) => {
    const roomId = [userId, friendId].sort().join('_');
    socket.join(roomId);
    const msgs = getMessages();
    socket.emit('chat_history', msgs[roomId] || []);
  });

  socket.on('send_msg', ({ fromId, toId, text, senderName }) => {
    const roomId = [fromId, toId].sort().join('_');
    const msgData = { senderId: fromId, senderName, text, time: new Date().toISOString() };

    let msgs = getMessages();
    if (!msgs[roomId]) msgs[roomId] = [];
    msgs[roomId].push(msgData);
    saveMessages(msgs);

    io.to(roomId).emit('new_msg', msgData);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);

    // Ставимо offline
    if (socket.userId) {
      let users = getUsers();
      const user = users.find(u => u.id === socket.userId);
      if (user) { user.status = 'offline'; saveUsers(users); }
    }

    console.log(`[SOCKET] Від'єднано: ${socket.id}`);
  });
});

// --- Lifecycle матчу ---
function runMatchLifecycle(matchId) {
  const match = activeMatches[matchId];
  if (!match) return;

  let warmup = 10; // 10 сек розминка
  match.timer = setInterval(() => {
    warmup--;
    io.to(matchId).emit('timer_update', { time: warmup, status: 'РОЗМИНКА' });
    if (warmup <= 0) {
      clearInterval(match.timer);
      match.players.forEach(p => { p.kills = 0; p.deaths = 0; p.hp = 100; });
      io.to(matchId).emit('update_score', match.players.map(p => ({
        userId: p.userId, nickname: p.nickname, kills: p.kills, hp: p.hp
      })));
      startMainMatch(matchId);
    }
  }, 1000);
}

function startMainMatch(matchId) {
  const match = activeMatches[matchId];
  if (!match) return;

  let time = 300; // 5 хвилин
  match.timer = setInterval(() => {
    time--;
    io.to(matchId).emit('timer_update', { time, status: 'TEAM FIGHT' });
    if (time <= 0) {
      clearInterval(match.timer);
      finishMatch(matchId);
    }
  }, 1000);
}

function finishMatch(matchId) {
  const match = activeMatches[matchId];
  if (!match) return;

  let users = getUsers();
  match.players.forEach(p => {
    const user = users.find(u => u.id === String(p.userId));
    if (user) {
      const xp = (p.kills * 20) + 10;
      const gold = p.kills * 2;
      user.gold = (user.gold || 0) + gold;
      user.XP = (user.XP || 0) + xp;

      io.to(p.socketId).emit('show_results', { xp, gold, kills: p.kills, deaths: p.deaths });
    }
  });
  saveUsers(users);

  setTimeout(() => {
    io.to(matchId).emit('kick_to_menu');
    delete activeMatches[matchId];
  }, 10000);
}

// --- Health check ---
app.get('/', (req, res) => res.json({ status: 'StandoffX Server Online', players: io.engine.clientsCount }));
app.get('/health', (req, res) => res.json({ ok: true }));

// --- START ---
server.listen(PORT, () => {
  console.log(`🎮 StandoffX Server запущено на порті ${PORT}`);
});
