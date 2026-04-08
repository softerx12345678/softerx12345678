const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// --- DATA STORAGE (JSON file) ---
const DB_FILE = "./db.json";

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { users: [], clans: [], messages: [], weapons: [], promoCodes: [] };
}

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

let db = loadDB();

// Ensure arrays exist
if (!db.weapons) db.weapons = [];
if (!db.promoCodes) db.promoCodes = [];
if (!db.messages) db.messages = [];
if (!db.clans) db.clans = [];

// --- HELPERS ---
function genId() { return "ID_" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
function genUUID() { return crypto.randomUUID(); }

function findUser(query) {
  return db.users.find(u => u.id === query || u.nickname === query || u.uuid === query);
}

// --- AVATARS ---
const DEFAULT_AVATARS = [
  "/images/default-avatar.jpg",
  "https://api.dicebear.com/7.x/bottts/svg?seed=1",
  "https://api.dicebear.com/7.x/bottts/svg?seed=2",
  "https://api.dicebear.com/7.x/bottts/svg?seed=3",
  "https://api.dicebear.com/7.x/bottts/svg?seed=4",
  "https://api.dicebear.com/7.x/bottts/svg?seed=5",
  "https://api.dicebear.com/7.x/bottts/svg?seed=6",
  "https://api.dicebear.com/7.x/bottts/svg?seed=7",
  "https://api.dicebear.com/7.x/bottts/svg?seed=8",
];

// --- AUTH ---
app.post("/api/register", (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.json({ success: false, message: "Missing fields" });
  if (db.users.find(u => u.nickname === nickname)) return res.json({ success: false, message: "Nickname taken" });
  
  const user = {
    uuid: genUUID(),
    id: genId(),
    nickname,
    password,
    playerAvatar: DEFAULT_AVATARS[0],
    status: "online",
    XP: 0,
    gold: 500,
    clan: null,
    clanRole: null,
    MMRCompetitive: 1000,
    MMRAllies: 1000,
    isVerified: false,
    isBanned: false,
    isAdmin: false,
    friendsList: [],
    incomingRequests: [],
    blocked: [],
    inventory: [],
    createdAt: new Date().toISOString(),
  };
  
  // First user with id containing Dev_01 check
  if (nickname === "Dev_01") user.isAdmin = true;
  
  db.users.push(user);
  saveDB();
  
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

app.post("/api/login", (req, res) => {
  const { nickname, password } = req.body;
  const user = db.users.find(u => (u.nickname === nickname || u.id === nickname) && u.password === password);
  if (!user) return res.json({ success: false, message: "Invalid credentials" });
  if (user.isBanned) return res.json({ success: false, message: "Account banned" });
  
  user.status = "online";
  saveDB();
  
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// --- USER DATA / SYNC ---
app.get("/api/user-data", (req, res) => {
  const user = findUser(req.query.uuid);
  if (!user) return res.json({ success: false });
  
  const friends = user.friendsList.map(fid => {
    const f = findUser(fid);
    if (!f) return null;
    return { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar, status: f.status, isVerified: f.isVerified };
  }).filter(Boolean);
  
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe, friends });
});

// --- UPDATE AVATAR ---
app.post("/api/update-avatar", (req, res) => {
  const { userId, avatar } = req.body;
  const user = findUser(userId);
  if (!user) return res.json({ success: false, message: "User not found" });
  user.playerAvatar = avatar;
  saveDB();
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// --- UPDATE NICKNAME ---
app.post("/api/update-nickname", (req, res) => {
  const { userId, newNickname } = req.body;
  const user = findUser(userId);
  if (!user) return res.json({ success: false, message: "User not found" });
  if (db.users.find(u => u.nickname === newNickname && u.id !== user.id)) {
    return res.json({ success: false, message: "Nickname already taken" });
  }
  if (newNickname.length < 2 || newNickname.length > 20) {
    return res.json({ success: false, message: "Nickname must be 2-20 characters" });
  }
  user.nickname = newNickname;
  saveDB();
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// --- AVAILABLE AVATARS ---
app.get("/api/avatars", (req, res) => {
  res.json({ success: true, avatars: DEFAULT_AVATARS });
});

// --- FRIENDS ---
app.get("/api/get-friends", (req, res) => {
  const user = findUser(req.query.userId);
  if (!user) return res.json({ success: false, friends: [] });
  const friends = user.friendsList.map(fid => {
    const f = findUser(fid);
    if (!f) return null;
    return { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar, status: f.status, isVerified: f.isVerified };
  }).filter(Boolean);
  res.json({ success: true, friends });
});

app.post("/api/search-user", (req, res) => {
  const { query } = req.body;
  const user = db.users.find(u => u.nickname === query || u.id === query);
  if (!user) return res.json({ success: false });
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

app.post("/api/friends/add", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  const friend = findUser(friendId);
  if (!me || !friend) return res.json({ success: false, message: "User not found" });
  if (me.id === friend.id) return res.json({ success: false, message: "Cannot add yourself" });
  if (me.friendsList.includes(friend.id)) return res.json({ success: false, message: "Already friends" });
  if (friend.incomingRequests.includes(me.id)) return res.json({ success: false, message: "Request already sent" });
  if (me.blocked.includes(friend.id) || friend.blocked.includes(me.id)) return res.json({ success: false, message: "User blocked" });
  
  friend.incomingRequests.push(me.id);
  saveDB();
  res.json({ success: true });
});

app.post("/api/friends/accept", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  const friend = findUser(friendId);
  if (!me || !friend) return res.json({ success: false });
  
  me.incomingRequests = me.incomingRequests.filter(id => id !== friend.id);
  if (!me.friendsList.includes(friend.id)) me.friendsList.push(friend.id);
  if (!friend.friendsList.includes(me.id)) friend.friendsList.push(me.id);
  saveDB();
  res.json({ success: true });
});

app.post("/api/friends/decline", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  if (!me) return res.json({ success: false });
  me.incomingRequests = me.incomingRequests.filter(id => id !== friendId);
  saveDB();
  res.json({ success: true });
});

app.post("/api/friends/remove", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  const friend = findUser(friendId);
  if (!me || !friend) return res.json({ success: false });
  me.friendsList = me.friendsList.filter(id => id !== friend.id);
  friend.friendsList = friend.friendsList.filter(id => id !== me.id);
  saveDB();
  res.json({ success: true });
});

app.get("/api/friends/requests", (req, res) => {
  const user = findUser(req.query.userId);
  if (!user) return res.json({ success: false, requests: [] });
  const requests = user.incomingRequests.map(id => {
    const f = findUser(id);
    if (!f) return null;
    return { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar, status: f.status };
  }).filter(Boolean);
  res.json({ success: true, requests });
});

app.get("/api/friends/blocked", (req, res) => {
  const user = findUser(req.query.userId);
  if (!user) return res.json({ success: false, blocked: [] });
  const blocked = user.blocked.map(id => {
    const f = findUser(id);
    if (!f) return null;
    return { id: f.id, nickname: f.nickname, playerAvatar: f.playerAvatar };
  }).filter(Boolean);
  res.json({ success: true, blocked });
});

app.post("/api/friends/block", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  const friend = findUser(friendId);
  if (!me || !friend) return res.json({ success: false });
  me.friendsList = me.friendsList.filter(id => id !== friend.id);
  friend.friendsList = friend.friendsList.filter(id => id !== me.id);
  if (!me.blocked.includes(friend.id)) me.blocked.push(friend.id);
  saveDB();
  res.json({ success: true });
});

app.post("/api/friends/unblock", (req, res) => {
  const { myId, friendId } = req.body;
  const me = findUser(myId);
  if (!me) return res.json({ success: false });
  me.blocked = me.blocked.filter(id => id !== friendId);
  saveDB();
  res.json({ success: true });
});

// --- CLANS ---
app.get("/api/get-clan", (req, res) => {
  const clan = db.clans.find(c => c.id === req.query.clanId || c.tag === req.query.clanId);
  if (!clan) return res.json({ success: false });
  const members = clan.members.map(m => {
    const u = findUser(m.id);
    if (!u) return null;
    return { id: u.id, nickname: u.nickname, role: m.role, status: u.status, playerAvatar: u.playerAvatar };
  }).filter(Boolean);
  res.json({ success: true, clan, members });
});

app.post("/api/clans/create", (req, res) => {
  const { userId, name, tag } = req.body;
  const user = findUser(userId);
  if (!user) return res.json({ success: false, message: "User not found" });
  if (user.clan) return res.json({ success: false, message: "Already in a clan" });
  if (db.clans.find(c => c.tag === tag)) return res.json({ success: false, message: "Tag taken" });
  
  const clan = {
    id: "CLAN_" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    name, tag,
    leader: user.id,
    members: [{ id: user.id, role: "leader" }],
    requests: [],
    createdAt: new Date().toISOString(),
  };
  db.clans.push(clan);
  user.clan = clan.id;
  user.clanRole = "leader";
  saveDB();
  res.json({ success: true, clan });
});

app.post("/api/clans/request", (req, res) => {
  const { userId, clanTag } = req.body;
  const user = findUser(userId);
  const clan = db.clans.find(c => c.tag === clanTag);
  if (!user || !clan) return res.json({ success: false, message: "Not found" });
  if (user.clan) return res.json({ success: false, message: "Already in a clan" });
  if (clan.requests?.includes(user.id)) return res.json({ success: false, message: "Already requested" });
  
  // Auto-join for simplicity
  clan.members.push({ id: user.id, role: "member" });
  user.clan = clan.id;
  user.clanRole = "member";
  saveDB();
  res.json({ success: true });
});

app.post("/api/clans/leave", (req, res) => {
  const { userId } = req.body;
  const user = findUser(userId);
  if (!user || !user.clan) return res.json({ success: false });
  const clan = db.clans.find(c => c.id === user.clan);
  if (clan) {
    clan.members = clan.members.filter(m => m.id !== user.id);
    if (clan.members.length === 0) {
      db.clans = db.clans.filter(c => c.id !== clan.id);
    } else if (clan.leader === user.id) {
      clan.leader = clan.members[0].id;
      clan.members[0].role = "leader";
    }
  }
  user.clan = null;
  user.clanRole = null;
  saveDB();
  res.json({ success: true });
});

app.get("/api/clans", (req, res) => {
  res.json({ success: true, clans: db.clans.map(c => ({ name: c.name, tag: c.tag, members: c.members.length })) });
});

// --- MESSAGES ---
app.get("/api/messages", (req, res) => {
  const { user1, user2 } = req.query;
  const msgs = db.messages.filter(m =>
    (m.fromId === user1 && m.toId === user2) || (m.fromId === user2 && m.toId === user1)
  ).sort((a, b) => new Date(a.time) - new Date(b.time));
  
  const formatted = msgs.map(m => {
    const sender = findUser(m.fromId);
    return { senderId: m.fromId, senderName: sender?.nickname || "Unknown", text: m.text, time: m.time };
  });
  res.json({ success: true, messages: formatted });
});

app.post("/api/send-message", (req, res) => {
  const { fromId, toId, text } = req.body;
  db.messages.push({ fromId, toId, text, time: new Date().toISOString() });
  saveDB();
  // Notify via socket
  io.to(toId).emit("new-message", { fromId, text, time: new Date().toISOString() });
  res.json({ success: true });
});

// --- ADMIN ---
app.get("/api/admin/users", (req, res) => {
  const { adminId } = req.query;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const users = db.users.map(u => {
    const { password: _, ...safe } = u;
    return safe;
  });
  res.json({ success: true, users });
});

app.post("/api/admin/ban", (req, res) => {
  const { adminId, targetId, ban } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const target = findUser(targetId);
  if (!target) return res.json({ success: false, message: "User not found" });
  target.isBanned = ban !== false;
  saveDB();
  res.json({ success: true });
});

app.post("/api/admin/verify", (req, res) => {
  const { adminId, targetId, verify } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const target = findUser(targetId);
  if (!target) return res.json({ success: false, message: "User not found" });
  target.isVerified = verify !== false;
  saveDB();
  res.json({ success: true });
});

app.post("/api/admin/set-admin", (req, res) => {
  const { adminId, targetId, isAdmin } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const target = findUser(targetId);
  if (!target) return res.json({ success: false, message: "User not found" });
  target.isAdmin = isAdmin !== false;
  saveDB();
  res.json({ success: true });
});

app.post("/api/admin/give-gold", (req, res) => {
  const { adminId, targetId, amount } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const target = findUser(targetId);
  if (!target) return res.json({ success: false, message: "User not found" });
  target.gold = (target.gold || 0) + Number(amount);
  saveDB();
  res.json({ success: true });
});

app.post("/api/admin/delete-user", (req, res) => {
  const { adminId, targetId } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  db.users = db.users.filter(u => u.id !== targetId);
  saveDB();
  res.json({ success: true });
});

// --- WEAPONS (Admin) ---
app.get("/api/admin/weapons", (req, res) => {
  res.json({ success: true, weapons: db.weapons });
});

app.post("/api/admin/weapons/add", (req, res) => {
  const { adminId, name, type, damage, fireRate, reloadTime, accuracy, price, rarity } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  const weapon = {
    id: "WPN_" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    name, type, damage: Number(damage), fireRate: Number(fireRate),
    reloadTime: Number(reloadTime), accuracy: Number(accuracy),
    price: Number(price), rarity: rarity || "common",
    createdAt: new Date().toISOString(),
  };
  db.weapons.push(weapon);
  saveDB();
  res.json({ success: true, weapon });
});

app.post("/api/admin/weapons/delete", (req, res) => {
  const { adminId, weaponId } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  db.weapons = db.weapons.filter(w => w.id !== weaponId);
  saveDB();
  res.json({ success: true });
});

// --- PROMO CODES (Admin) ---
app.get("/api/admin/promos", (req, res) => {
  const { adminId } = req.query;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false });
  res.json({ success: true, promos: db.promoCodes });
});

app.post("/api/admin/promos/create", (req, res) => {
  const { adminId, code, reward, maxUses } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false, message: "Unauthorized" });
  if (db.promoCodes.find(p => p.code === code)) return res.json({ success: false, message: "Code exists" });
  const promo = {
    code, reward: reward || "gold:500", maxUses: Number(maxUses) || 100,
    usedBy: [], createdAt: new Date().toISOString(),
  };
  db.promoCodes.push(promo);
  saveDB();
  res.json({ success: true, promo });
});

app.post("/api/admin/promos/delete", (req, res) => {
  const { adminId, code } = req.body;
  const admin = findUser(adminId);
  if (!admin || !admin.isAdmin) return res.json({ success: false });
  db.promoCodes = db.promoCodes.filter(p => p.code !== code);
  saveDB();
  res.json({ success: true });
});

// Player redeem promo
app.post("/api/redeem-promo", (req, res) => {
  const { userId, code } = req.body;
  const user = findUser(userId);
  if (!user) return res.json({ success: false, message: "User not found" });
  const promo = db.promoCodes.find(p => p.code === code);
  if (!promo) return res.json({ success: false, message: "Invalid code" });
  if (promo.usedBy.includes(user.id)) return res.json({ success: false, message: "Already redeemed" });
  if (promo.usedBy.length >= promo.maxUses) return res.json({ success: false, message: "Code expired" });
  
  // Parse reward
  const [type, amount] = promo.reward.split(":");
  if (type === "gold") user.gold = (user.gold || 0) + Number(amount);
  else if (type === "xp") user.XP = (user.XP || 0) + Number(amount);
  
  promo.usedBy.push(user.id);
  saveDB();
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe, message: `Отримано: ${amount} ${type}` });
});

// --- MATCHMAKING ---
const matchQueue = new Map(); // mode -> [{socketId, userId, mmr}]
const activeMatches = new Map(); // matchId -> matchState

app.get("/api/ping", (req, res) => {
  res.json({ success: true, time: Date.now(), players: io.engine.clientsCount });
});

// Socket.IO for real-time
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);
  
  socket.on("register-user", (userId) => {
    socket.userId = userId;
    socket.join(userId);
    const user = findUser(userId);
    if (user) { user.status = "online"; saveDB(); }
    io.emit("player-count", io.engine.clientsCount);
  });
  
  // --- MATCHMAKING ---
  socket.on("queue-join", ({ mode, userId }) => {
    const user = findUser(userId);
    if (!user) return;
    
    if (!matchQueue.has(mode)) matchQueue.set(mode, []);
    const queue = matchQueue.get(mode);
    
    // Remove if already in queue
    const existing = queue.findIndex(p => p.userId === userId);
    if (existing !== -1) queue.splice(existing, 1);
    
    const mmr = mode === 1 ? user.MMRCompetitive : user.MMRAllies;
    queue.push({ socketId: socket.id, userId, mmr, joinedAt: Date.now() });
    
    socket.emit("queue-status", { position: queue.length, mode });
    
    // Try to form a match
    tryFormMatch(mode);
  });
  
  socket.on("queue-leave", ({ mode }) => {
    if (!matchQueue.has(mode)) return;
    const queue = matchQueue.get(mode);
    const idx = queue.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) queue.splice(idx, 1);
    socket.emit("queue-left");
  });
  
  // --- IN-MATCH ---
  socket.on("match-action", ({ matchId, action, data }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;
    
    // Broadcast action to all players in match
    match.players.forEach(p => {
      if (p.socketId !== socket.id) {
        io.to(p.socketId).emit("match-update", { action, data, from: socket.userId });
      }
    });
  });
  
  socket.on("match-result", ({ matchId, winnerId }) => {
    const match = activeMatches.get(matchId);
    if (!match) return;
    
    // Update MMR
    match.players.forEach(p => {
      const user = findUser(p.userId);
      if (!user) return;
      const field = match.mode === 1 ? "MMRCompetitive" : "MMRAllies";
      if (p.userId === winnerId) {
        user[field] = Math.min(3000, user[field] + 25);
        user.XP = (user.XP || 0) + 50;
        user.gold = (user.gold || 0) + 100;
      } else {
        user[field] = Math.max(0, user[field] - 20);
        user.XP = (user.XP || 0) + 10;
        user.gold = (user.gold || 0) + 20;
      }
    });
    
    saveDB();
    activeMatches.delete(matchId);
  });
  
  socket.on("disconnect", () => {
    // Remove from all queues
    for (const [mode, queue] of matchQueue) {
      const idx = queue.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) queue.splice(idx, 1);
    }
    
    if (socket.userId) {
      const user = findUser(socket.userId);
      if (user) { user.status = "offline"; saveDB(); }
    }
    
    io.emit("player-count", io.engine.clientsCount);
    console.log("Player disconnected:", socket.id);
  });
});

function tryFormMatch(mode) {
  const queue = matchQueue.get(mode);
  if (!queue) return;
  
  const playersNeeded = mode === 1 ? 2 : 4; // 1v1 or 2v2
  
  if (queue.length >= playersNeeded) {
    // Sort by MMR for fair matching
    queue.sort((a, b) => a.mmr - b.mmr);
    
    const matchPlayers = queue.splice(0, playersNeeded);
    const matchId = "MATCH_" + crypto.randomBytes(6).toString("hex").toUpperCase();
    
    const matchState = {
      id: matchId,
      mode,
      players: matchPlayers,
      startedAt: Date.now(),
      status: "active",
    };
    
    activeMatches.set(matchId, matchState);
    
    // Assign teams
    const teams = mode === 2 
      ? { team1: matchPlayers.slice(0, 2), team2: matchPlayers.slice(2) }
      : { team1: [matchPlayers[0]], team2: [matchPlayers[1]] };
    
    // Notify all players
    matchPlayers.forEach(p => {
      const playerData = matchPlayers.map(mp => {
        const u = findUser(mp.userId);
        return { id: mp.userId, nickname: u?.nickname, avatar: u?.playerAvatar, mmr: mp.mmr };
      });
      
      io.to(p.socketId).emit("match-found", {
        matchId,
        mode,
        players: playerData,
        teams,
      });
    });
    
    console.log(`Match formed: ${matchId} (mode ${mode}, ${playersNeeded} players)`);
  }
}

// --- SERVER START ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`StandoffX Server running on port ${PORT}`);
  console.log(`Players in DB: ${db.users.length}`);
  console.log(`Clans: ${db.clans.length}`);
});
