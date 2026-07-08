import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import { pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import pokerSolver from "pokersolver";

const { Hand } = pokerSolver;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
const PORT = process.env.PORT || 3000;
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;
const STARTING_CHIPS = 200;
const BUY_IN_AMOUNT = 100;
const DEFAULT_BOT_BUY_IN = STARTING_CHIPS;
const BOT_PROFILES = [
  { key: "looseAggressive", aggression: 0.86, looseness: 0.78, bluff: 0.24, call: 0.6, raiseThreshold: 0.58, allInThreshold: 0.9, threeBet: 0.24 },
  { key: "tightPassive", aggression: 0.28, looseness: 0.28, bluff: 0.04, call: 0.36, raiseThreshold: 0.78, allInThreshold: 0.96, threeBet: 0.06 },
  { key: "balanced", aggression: 0.56, looseness: 0.5, bluff: 0.12, call: 0.5, raiseThreshold: 0.68, allInThreshold: 0.93, threeBet: 0.14 },
  { key: "tricky", aggression: 0.7, looseness: 0.62, bluff: 0.3, call: 0.46, raiseThreshold: 0.64, allInThreshold: 0.92, threeBet: 0.18 },
];
const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const rooms = new Map();
const users = loadUsers();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));

app.post("/api/register", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const name = sanitizePlayerName(req.body?.name || username);
  if (!validUsername(username)) return res.status(400).json({ ok: false, error: "账号只能使用 3-24 位字母、数字、下划线、点或横线" });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ ok: false, error: "密码长度需要 6-72 位" });
  if (users[username]) return res.status(409).json({ ok: false, error: "账号已存在" });

  const salt = randomBytes(16).toString("hex");
  const user = {
    id: randomBytes(16).toString("hex"),
    username,
    name,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  users[username] = user;
  saveUsers();
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const user = users[username];
  if (!user || !verifyPassword(password, user)) return res.status(401).json({ ok: false, error: "账号或密码错误" });
  res.json({ ok: true, user: publicUser(user) });
});

function loadUsers() {
  try {
    if (!existsSync(USERS_FILE)) return {};
    return JSON.parse(readFileSync(USERS_FILE, "utf8"));
  } catch (error) {
    console.error("Failed to load users.json", error);
    return {};
  }
}

function saveUsers() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validUsername(username) {
  return /^[a-z0-9_.-]{3,24}$/.test(username);
}

function sanitizePlayerName(value) {
  return String(value || "玩家").trim().slice(0, 16) || "玩家";
}

function hashPassword(password, salt) {
  return pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return {
    username: user.username,
    name: user.name,
    token: `account:${user.id}`,
  };
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function makeDeck() {
  const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const suits = ["s", "h", "d", "c"];
  const deck = ranks.flatMap((rank) => suits.map((suit) => `${rank}${suit}`));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function newRoom(code = roomCode()) {
  const room = {
    code,
    players: [],
    deck: [],
    community: [],
    communityRuns: [],
    dealerSeat: -1,
    smallBlindSeat: null,
    bigBlindSeat: null,
    turnSeat: null,
    phase: "lobby",
    pot: 0,
    currentBet: 0,
    minRaise: 1,
    smallBlind: 1,
    bigBlind: 2,
    gameMode: "normal",
    botBuyIn: DEFAULT_BOT_BUY_IN,
    rewardPool: 0,
    rewardAnte: 5,
    acted: new Set(),
    message: "绛夊緟鐜╁鍔犲叆",
    winners: [],
    revealedSeats: new Set(),
    runout: null,
    buyRequests: [],
  };
  rooms.set(code, room);
  return room;
}

function seatedPlayers(room) {
  return room.players.filter((player) => player.connected);
}

function livePlayers(room) {
  refillBustedBots(room);
  return room.players.filter((player) => player.connected && player.chips > 0 && (player.isBot || player.ready));
}

function activePlayers(room) {
  return room.players.filter((player) => player.connected && !player.folded && player.inHand);
}

function canActPlayers(room) {
  return activePlayers(room).filter((player) => !player.allIn);
}

function nextSeat(room, fromSeat, predicate = () => true) {
  if (room.players.length === 0) return null;
  for (let offset = 1; offset <= 8; offset += 1) {
    const seat = (fromSeat + offset) % 8;
    const player = room.players.find((candidate) => candidate.seat === seat);
    if (player && player.connected && predicate(player)) return seat;
  }
  return null;
}

function seatOf(room, socketId) {
  return room.players.find((player) => player.id === socketId)?.seat ?? null;
}

function publicPlayer(player, viewerId, room) {
  const showHand = player.id === viewerId || room.revealedSeats.has(player.seat);
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    chips: player.chips,
    bet: player.bet,
    folded: player.folded,
    allIn: player.allIn,
    connected: player.connected,
    reconnecting: player.reconnecting,
    inHand: player.inHand,
    ready: player.ready,
    isBot: player.isBot,
    hand: showHand ? player.hand : player.hand.map(() => "back"),
  };
}

function snapshot(room, viewerId) {
  const me = room.players.find((player) => player.id === viewerId);
  const toCall = me && room.turnSeat === me.seat ? Math.max(0, room.currentBet - me.bet) : 0;
  return {
    code: room.code,
    phase: room.phase,
    community: room.community,
    communityRuns: room.communityRuns,
    pot: room.pot + room.players.reduce((sum, player) => sum + player.bet, 0),
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    gameMode: room.gameMode,
    botBuyIn: room.botBuyIn,
    rewardPool: room.rewardPool,
    rewardAnte: room.rewardAnte,
    dealerSeat: room.dealerSeat,
    smallBlindSeat: room.smallBlindSeat,
    bigBlindSeat: room.bigBlindSeat,
    turnSeat: room.turnSeat,
    message: room.message,
    winners: room.winners,
    meSeat: me?.seat ?? null,
    toCall,
    minBet: 1,
    runoutPrompt: publicRunoutPrompt(room, me),
    buyRequests: publicBuyRequests(room, viewerId),
    players: room.players.map((player) => publicPlayer(player, viewerId, room)),
  };
}

function publicRunoutPrompt(room, me) {
  if (room.phase !== "runoutChoice" || !me || !room.runout?.seats.includes(me.seat)) return null;
  if (room.runout.choices[me.seat]) return null;
  return {
    seats: room.runout.seats,
    message: "双方全下，选择发一次还是发两次",
  };
}

function publicBuyRequests(room, viewerId) {
  return room.buyRequests
    .filter((request) => request.status === "pending" && (request.fromId === viewerId || request.toId === viewerId))
    .map((request) => ({
      id: request.id,
      amount: request.amount,
      fromSeat: request.fromSeat,
      toSeat: request.toSeat,
      fromName: request.fromName,
      toName: request.toName,
      direction: request.fromId === viewerId ? "outgoing" : "incoming",
    }));
}

function emitRoom(room) {
  room.players.forEach((player) => {
    if (player.connected && !player.isBot) io.to(player.id).emit("state", snapshot(room, player.id));
  });
}

function humanPlayers(room) {
  return room.players.filter((player) => player.connected && !player.isBot && player.chips > 0);
}

function canAutoStart(room) {
  refillBustedBots(room);
  const humans = humanPlayers(room);
  return (
    (room.phase === "lobby" || room.phase === "showdown") &&
    livePlayers(room).length >= 2 &&
    humans.length > 0 &&
    humans.every((player) => player.ready)
  );
}

function inPlayingPhase(room) {
  return ["preflop", "flop", "turn", "river", "runoutChoice"].includes(room.phase);
}

function normalizeBuyAmount(amount) {
  const value = Math.floor(Number(amount) || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(1, Math.min(10000, value));
}

function refillBustedBots(room) {
  room.players.forEach((player) => {
    if (!player.isBot || player.inHand || player.chips > 0) return;
    player.chips += room.botBuyIn || DEFAULT_BOT_BUY_IN;
    player.ready = true;
    player.allIn = false;
    player.folded = false;
  });
}

function checkAutoStart(room) {
  if (canAutoStart(room)) {
    room.message = "所有玩家已准备，自动发牌";
    startHand(room);
  } else {
    emitRoom(room);
  }
}

function collectBets(room) {
  room.pot += room.players.reduce((sum, player) => sum + player.bet, 0);
  room.players.forEach((player) => {
    player.bet = 0;
  });
  room.currentBet = 0;
  room.minRaise = 1;
  room.acted.clear();
}

function dealCommunity(room, count) {
  for (let i = 0; i < count; i += 1) room.community.push(room.deck.pop());
}

function startHand(room) {
  const players = livePlayers(room);
  if (players.length < 2) {
    room.message = "至少需要 2 位已准备玩家才能开始";
    emitRoom(room);
    return;
  }

  room.deck = makeDeck();
  room.community = [];
  room.communityRuns = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = 1;
  room.acted.clear();
  room.winners = [];
  room.revealedSeats = new Set();
  room.runout = null;
  room.phase = "preflop";

  players.forEach((player) => {
    player.hand = [room.deck.pop(), room.deck.pop()];
    player.bet = 0;
    player.committed = 0;
    player.folded = false;
    player.allIn = false;
    player.inHand = true;
    player.ready = false;
  });
  room.players.filter((player) => !players.includes(player)).forEach((player) => {
    player.inHand = false;
    player.hand = [];
    player.bet = 0;
    player.committed = 0;
    if (!player.isBot) player.ready = false;
  });
  room.players.filter((player) => player.isBot).forEach((player) => {
    player.ready = true;
  });

  const nextDealer = nextSeat(room, room.dealerSeat, (player) => player.inHand && player.chips > 0);
  room.dealerSeat = nextDealer ?? players[0].seat;
  const isHeadsUp = players.length === 2;
  const smallBlindSeat = isHeadsUp
    ? room.dealerSeat
    : nextSeat(room, room.dealerSeat, (player) => player.inHand && player.chips > 0);
  const bigBlindSeat = nextSeat(room, smallBlindSeat, (player) => player.inHand && player.chips > 0);
  room.smallBlindSeat = smallBlindSeat;
  room.bigBlindSeat = bigBlindSeat;
  seedRewardPool(room, players);
  postBlind(room, smallBlindSeat, room.smallBlind);
  postBlind(room, bigBlindSeat, room.bigBlind);
  room.currentBet = Math.max(...players.map((player) => player.bet));
  room.turnSeat = nextSeat(room, bigBlindSeat, (player) => player.inHand && !player.allIn && !player.folded);
  room.message = "新一手开始";
  emitRoom(room);
  scheduleBot(room);
}

function postBlind(room, seat, amount) {
  const player = room.players.find((candidate) => candidate.seat === seat);
  if (!player) return;
  const paid = Math.min(player.chips, amount);
  player.chips -= paid;
  player.bet += paid;
  player.committed += paid;
  player.allIn = player.chips === 0;
}

function bettingComplete(room) {
  const actors = canActPlayers(room);
  if (actors.length === 0) return true;
  if (preflopBlindCallComplete(room, actors)) return true;
  return actors.every((player) => room.acted.has(player.seat) && player.bet === room.currentBet);
}

function preflopBlindCallComplete(room, actors) {
  if (room.gameMode !== "reward" || room.phase !== "preflop" || room.bigBlindSeat === null) return false;
  if (room.currentBet > room.bigBlind) return false;
  return actors
    .filter((player) => player.seat !== room.bigBlindSeat)
    .every((player) => room.acted.has(player.seat) && player.bet === room.currentBet);
}

function advanceGame(room) {
  const remaining = activePlayers(room);
  if (remaining.length === 1) {
    collectBets(room);
    const winner = remaining[0];
    winner.chips += room.pot;
    room.winners = [{ seat: winner.seat, name: winner.name, amount: room.pot, hand: "其他玩家弃牌" }];
    room.message = `${winner.name} 赢得底池`;
    room.pot = 0;
    room.revealedSeats = new Set();
    room.phase = "showdown";
    room.turnSeat = null;
    settleRewardPool(room, [winner.seat]);
    prepareNextHand(room);
    emitRoom(room);
    return;
  }

  if (!bettingComplete(room)) {
    room.turnSeat = nextSeat(room, room.turnSeat, (player) => player.inHand && !player.folded && !player.allIn);
    emitRoom(room);
    scheduleBot(room);
    return;
  }

  collectBets(room);
  if (shouldOfferRunoutChoice(room)) {
    startRunoutChoice(room);
    return;
  }

  if (shouldRunoutToShowdown(room)) {
    dealRemainingCommunity(room);
    showdown(room);
    return;
  }

  if (room.phase === "preflop") {
    room.phase = "flop";
    dealCommunity(room, 3);
  } else if (room.phase === "flop") {
    room.phase = "turn";
    dealCommunity(room, 1);
  } else if (room.phase === "turn") {
    room.phase = "river";
    dealCommunity(room, 1);
  } else {
    showdown(room);
    return;
  }

  room.turnSeat = nextSeat(room, room.dealerSeat, (player) => player.inHand && !player.folded && !player.allIn);
  if (room.turnSeat === null) showdown(room);
  else {
    room.message = streetName(room.phase);
    emitRoom(room);
    scheduleBot(room);
  }
}

function streetName(phase) {
  return { flop: "翻牌圈", turn: "转牌圈", river: "河牌圈" }[phase] ?? phase;
}

function shouldRunoutToShowdown(room) {
  const remaining = activePlayers(room);
  return remaining.length >= 2 && remaining.some((player) => player.allIn) && canActPlayers(room).length <= 1;
}

function shouldOfferRunoutChoice(room) {
  const remaining = activePlayers(room);
  return remaining.length === 2 && remaining.every((player) => player.allIn);
}

function startRunoutChoice(room) {
  const contenders = activePlayers(room);
  room.phase = "runoutChoice";
  room.turnSeat = null;
  room.runout = {
    seats: contenders.map((player) => player.seat),
    choices: {},
  };
  contenders.filter((player) => player.isBot).forEach((player) => {
    room.runout.choices[player.seat] = "once";
  });
  room.message = "双方全下，等待选择发一次或发两次";
  emitRoom(room);
  finishRunoutChoiceIfReady(room);
}

function chooseRunout(room, socket, choice) {
  if (room.phase !== "runoutChoice" || !room.runout) return;
  const player = room.players.find((candidate) => candidate.id === socket.id);
  if (!player || !room.runout.seats.includes(player.seat)) return;
  room.runout.choices[player.seat] = choice === "twice" ? "twice" : "once";
  room.message = `${player.name} 选择${room.runout.choices[player.seat] === "twice" ? "发两次" : "发一次"}`;
  emitRoom(room);
  finishRunoutChoiceIfReady(room);
}

function finishRunoutChoiceIfReady(room) {
  if (room.phase !== "runoutChoice" || !room.runout) return;
  const choices = room.runout.seats.map((seat) => room.runout.choices[seat]);
  if (choices.includes("once")) {
    runItOnce(room);
    return;
  }
  if (choices.every(Boolean)) runItTwice(room);
}

function runItOnce(room) {
  room.runout = null;
  dealRemainingCommunity(room);
  showdown(room);
}

function runItTwice(room) {
  const firstBoard = completeBoard(room, room.community);
  const secondBoard = completeBoard(room, room.community);
  room.community = firstBoard;
  room.communityRuns = [firstBoard, secondBoard];
  room.runout = null;
  room.message = "双方选择发两次";
  showdown(room, [firstBoard, secondBoard]);
}

function completeBoard(room, baseCards) {
  const board = [...baseCards];
  while (board.length < 5) board.push(room.deck.pop());
  return board;
}

function dealRemainingCommunity(room) {
  const missingCards = Math.max(0, 5 - room.community.length);
  if (missingCards > 0) dealCommunity(room, missingCards);
  room.communityRuns = [];
  room.phase = "river";
}

function showdown(room, boards = [room.community]) {
  collectBets(room);
  const contenders = activePlayers(room);
  room.revealedSeats = new Set(contenders.map((player) => player.seat));
  const winnerMap = new Map();
  buildSidePots(room).forEach((sidePot) => {
    const eligible = sidePot.eligible.filter((player) => contenders.includes(player));
    if (eligible.length === 0 || sidePot.amount <= 0) return;
    if (eligible.length === 1) {
      awardWinner(winnerMap, eligible[0], sidePot.amount, "未被跟注");
      return;
    }
    awardContestedSidePot(winnerMap, eligible, sidePot.amount, boards);
  });
  room.winners = [...winnerMap.values()];
  room.message = `${room.winners.map((winner) => winner.name).join("、")} 赢得底池`;
  room.pot = 0;
  room.phase = "showdown";
  room.turnSeat = null;
  settleRewardPool(room, room.winners.map((winner) => winner.seat));
  prepareNextHand(room);
  emitRoom(room);
}

function awardContestedSidePot(winnerMap, eligible, amount, boards) {
  const boardCount = boards.length || 1;
  const boardAmounts = Array.from({ length: boardCount }, (_, index) => (
    Math.floor(amount / boardCount) + (index < amount % boardCount ? 1 : 0)
  ));
  boards.forEach((board, boardIndex) => {
    const solved = eligible.map((player) => ({
      player,
      hand: Hand.solve([...player.hand, ...board]),
    }));
    const winningHands = Hand.winners(solved.map((item) => item.hand));
    const winners = solved.filter((item) => winningHands.includes(item.hand));
    const boardAmount = boardAmounts[boardIndex];
    const share = Math.floor(boardAmount / winners.length);
    const remainder = boardAmount % winners.length;
    winners.forEach(({ player, hand }, index) => {
      const label = boards.length > 1 ? `第${boardIndex + 1}次 ${hand.descr}` : hand.descr;
      awardWinner(winnerMap, player, share + (index < remainder ? 1 : 0), label);
    });
  });
}

function buildSidePots(room) {
  const contributors = room.players.filter((player) => player.inHand && (player.committed || 0) > 0);
  const levels = [...new Set(contributors.map((player) => player.committed).sort((a, b) => a - b))];
  let previousLevel = 0;
  return levels.map((level) => {
    const levelContributors = contributors.filter((player) => player.committed >= level);
    const amount = (level - previousLevel) * levelContributors.length;
    previousLevel = level;
    return {
      amount,
      eligible: levelContributors.filter((player) => !player.folded),
    };
  }).filter((sidePot) => sidePot.amount > 0);
}

function awardWinner(winnerMap, player, amount, hand) {
  player.chips += amount;
  const current = winnerMap.get(player.seat);
  if (current) {
    current.amount += amount;
    if (current.hand === "未被跟注" && hand !== "未被跟注") current.hand = hand;
    else if (hand !== "未被跟注" && !current.hand.includes(hand)) current.hand += `；${hand}`;
    return;
  }
  winnerMap.set(player.seat, {
    seat: player.seat,
    name: player.name,
    amount,
    hand,
  });
}

function seedRewardPool(room, players) {
  if (room.gameMode !== "reward" || room.rewardPool > 0) return;
  let collected = 0;
  players.forEach((player) => {
    const paid = Math.min(player.chips, room.rewardAnte);
    player.chips -= paid;
    player.allIn = player.chips === 0;
    collected += paid;
  });
  room.rewardPool += collected;
}

function settleRewardPool(room, winningSeats) {
  if (room.gameMode !== "reward" || room.smallBlindSeat === null || room.rewardPool <= 0) return;
  const smallBlindPlayer = room.players.find((player) => player.seat === room.smallBlindSeat);
  if (!smallBlindPlayer) return;

  if (winningSeats.includes(room.smallBlindSeat)) {
    const reward = room.rewardPool;
    smallBlindPlayer.chips += reward;
    room.rewardPool = 0;
    room.message += `；小盲赢得鱿鱼池 ${reward}`;
    return;
  }

  smallBlindPlayer.chips -= room.rewardAnte;
  room.rewardPool += room.rewardAnte;
  room.message += `；小盲未中鱿鱼，追加 ${room.rewardAnte} 到鱿鱼池`;
}

function prepareNextHand(room) {
  room.players.forEach((player) => {
    player.inHand = false;
    player.bet = 0;
    player.committed = 0;
    player.folded = false;
    player.allIn = false;
    player.ready = Boolean(player.isBot && player.chips > 0);
  });
  room.players = room.players.filter((player) => !player.left);
  refillBustedBots(room);
}

function act(room, socket, type, amount = 0) {
  const player = room.players.find((candidate) => candidate.id === socket.id);
  if (!player || player.seat !== room.turnSeat || room.phase === "lobby" || room.phase === "showdown") return;

  const toCall = Math.max(0, room.currentBet - player.bet);
  if (type === "fold") {
    player.folded = true;
    room.acted.add(player.seat);
    room.message = `${player.name} 弃牌`;
  } else if (type === "checkCall") {
    const paid = Math.min(player.chips, toCall);
    player.chips -= paid;
    player.bet += paid;
    player.committed += paid;
    player.allIn = player.chips === 0;
    room.acted.add(player.seat);
    room.message = toCall > 0 ? `${player.name} 跟注` : `${player.name} 过牌`;
  } else if (type === "raise") {
    const paid = Math.min(player.chips, Math.floor(Number(amount) || 0));
    if (paid <= 0) return;
    player.chips -= paid;
    player.bet += paid;
    player.committed += paid;
    player.allIn = player.chips === 0;
    if (player.bet > room.currentBet) {
      room.minRaise = 1;
      room.currentBet = player.bet;
      room.acted.clear();
    }
    room.acted.add(player.seat);
    room.message = `${player.name} 下注 ${paid}`;
  } else if (type === "allIn") {
    const previousBet = room.currentBet;
    const paid = player.chips;
    player.bet += paid;
    player.committed += paid;
    player.chips = 0;
    player.allIn = true;
    if (player.bet > room.currentBet) {
      room.currentBet = player.bet;
      room.minRaise = 1;
      room.acted.clear();
    }
    room.acted.add(player.seat);
    room.message = `${player.name} 全下`;
  }

  advanceGame(room);
}

function scheduleBot(room) {
  const bot = room.players.find((player) => player.seat === room.turnSeat && player.isBot);
  if (!bot || room.botTimer) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const currentBot = room.players.find((player) => player.seat === room.turnSeat && player.isBot);
    if (currentBot) botAct(room, currentBot);
  }, 650);
}

function botAct(room, bot) {
  if (!bot.inHand || bot.folded || bot.allIn || room.phase === "lobby" || room.phase === "showdown") return;
  const toCall = Math.max(0, room.currentBet - bot.bet);
  const profile = bot.aiProfile || BOT_PROFILES[2];
  const equity = botEquity(room, bot, profile);
  const draw = botDrawPressure(room, bot);
  const pot = Math.max(room.bigBlind * 2, tablePot(room));
  const potOdds = toCall > 0 ? toCall / Math.max(1, pot + toCall) : 0;
  const stackAfterCall = bot.chips - Math.min(bot.chips, toCall);
  const stackPressure = toCall / Math.max(1, bot.chips + bot.bet);
  const spr = stackAfterCall / Math.max(1, pot + toCall);
  const canRaise = bot.chips > toCall + room.bigBlind;
  const raiseAmount = botRaiseAmount(room, bot, equity, profile, toCall);
  const roll = Math.random();
  const valueRaise = canRaise && equity >= profile.raiseThreshold && roll < profile.aggression;
  const semiBluff = canRaise && draw >= 0.08 && equity >= 0.38 && roll < profile.bluff + draw * 1.45;
  const pureBluff = canRaise && toCall === 0 && equity < 0.48 && roll < profile.bluff * (room.community.length ? 0.65 : 0.38);
  const lightThreeBet = canRaise && room.phase === "preflop" && toCall > 0 && equity > 0.5 && roll < profile.threeBet;
  const shoveReady = canRaise && spr < 1.8 && (equity >= profile.allInThreshold || (semiBluff && roll < profile.bluff * 0.45));
  const callFloor = potOdds + 0.05 - profile.call * 0.08 - draw * 0.65;

  if (toCall >= bot.chips) {
    actBot(room, bot, equity >= Math.max(0.42, potOdds + 0.1) || (draw >= 0.12 && roll < profile.call) ? "allIn" : "fold");
  } else if (shoveReady) {
    actBot(room, bot, "allIn");
  } else if (toCall === 0) {
    actBot(room, bot, (valueRaise || semiBluff || pureBluff || (canRaise && equity > 0.54 && roll < profile.aggression * 0.32)) ? "raise" : "checkCall", raiseAmount);
  } else if (valueRaise || semiBluff || lightThreeBet) {
    actBot(room, bot, "raise", raiseAmount);
  } else if (equity < callFloor && stackPressure > 0.08 && roll > profile.bluff) {
    actBot(room, bot, "fold");
  } else if (equity < 0.36 && stackPressure > 0.28 && roll > profile.call + draw) {
    actBot(room, bot, "fold");
  } else {
    actBot(room, bot, "checkCall");
  }
}

function actBot(room, bot, type, amount = 0) {
  const fakeSocket = { id: bot.id };
  act(room, fakeSocket, type, amount);
}

function botRaiseAmount(room, bot, equity, profile = BOT_PROFILES[2], toCall = Math.max(0, room.currentBet - bot.bet)) {
  const pot = Math.max(room.bigBlind * 2, tablePot(room));
  const street = room.community.length;
  const preflop = street === 0;
  const valueBias = clamp((equity - 0.52) * 1.8, 0, 0.55);
  const randomMix = Math.random() * 0.08;
  const potFraction = preflop
    ? 0
    : clamp(0.33 + profile.aggression * 0.18 + valueBias + randomMix, 0.33, equity > 0.82 ? 1.05 : 0.78);
  const openSize = Math.ceil(room.bigBlind * (2.4 + profile.aggression * 1.1 + Math.random() * 0.35));
  const threeBetSize = Math.ceil((room.currentBet || room.bigBlind) * (2.45 + profile.aggression * 1.15 + Math.random() * 0.35));
  const targetBet = preflop
    ? Math.max(room.currentBet + room.minRaise, toCall > 0 ? threeBetSize : openSize)
    : Math.max(room.currentBet + room.minRaise, bot.bet + toCall + Math.ceil(pot * potFraction));
  const amountToPay = targetBet - bot.bet;
  return Math.min(bot.chips, Math.max(1, amountToPay));
}

function tablePot(room) {
  return room.pot + room.players.reduce((sum, player) => sum + player.bet, 0);
}

function botStrength(room, bot) {
  return room.community.length >= 3 ? postflopStrength(room, bot) : preflopStrength(bot.hand);
}

function botEquity(room, bot, profile = BOT_PROFILES[2]) {
  const base = botStrength(room, bot);
  const looseBonus = (profile.looseness - 0.5) * 0.12;
  const aggressionBonus = (profile.aggression - 0.5) * 0.04;
  return clamp(base + looseBonus + aggressionBonus, 0.05, 0.98);
}

function botDrawPressure(room, bot) {
  if (room.community.length < 3) return 0;
  return drawBonus([...bot.hand, ...room.community]);
}

function preflopStrength(hand) {
  if (hand.length < 2) return 0.35;
  const [a, b] = hand;
  const high = Math.max(cardRank(a), cardRank(b));
  const low = Math.min(cardRank(a), cardRank(b));
  const suited = a[1] === b[1];
  const gap = high - low;
  let score = 0.16 + high / 30 + low / 48;
  if (high === low) score = 0.48 + high / 25;
  if (suited) score += 0.07;
  if (gap === 1) score += 0.075;
  else if (gap === 2) score += 0.045;
  else if (gap === 3) score += 0.02;
  else if (gap >= 5) score -= 0.09;
  if (high >= 14 && low >= 10) score += 0.08;
  if (high >= 13 && low >= 11) score += 0.045;
  if (high <= 9 && low <= 6 && !suited && gap >= 3) score -= 0.08;
  return clamp(score, 0.16, 0.96);
}

function postflopStrength(room, bot) {
  const solved = Hand.solve([...bot.hand, ...room.community]);
  const made = solved.rank / 9;
  const kickers = solved.cards.slice(0, 2).reduce((sum, card) => sum + (card.rank + 2), 0) / 28;
  const draw = drawBonus([...bot.hand, ...room.community]);
  return clamp(made * 0.78 + kickers * 0.12 + draw, 0.18, 0.98);
}

function drawBonus(cards) {
  const suits = new Map();
  const ranks = new Set();
  cards.forEach((card) => {
    suits.set(card[1], (suits.get(card[1]) || 0) + 1);
    ranks.add(cardRank(card));
    if (cardRank(card) === 14) ranks.add(1);
  });
  const flushDraw = [...suits.values()].some((count) => count >= 4) ? 0.12 : 0;
  let straightDraw = 0;
  for (let start = 1; start <= 10; start += 1) {
    let hits = 0;
    for (let rank = start; rank < start + 5; rank += 1) {
      if (ranks.has(rank)) hits += 1;
    }
    if (hits >= 4) straightDraw = 0.11;
    else if (hits >= 3) straightDraw = Math.max(straightDraw, 0.035);
  }
  return flushDraw + straightDraw;
}

function cardRank(card) {
  return RANK_VALUE[card[0]] || 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, token }, reply) => {
    const room = newRoom();
    joinRoom(socket, room, name, token);
    reply?.({ ok: true, code: room.code });
  });

  socket.on("joinRoom", ({ code, name, token }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) {
      reply?.({ ok: false, error: "找不到这个房间" });
      return;
    }
    const restored = restorePlayer(socket, room, name, token);
    if (restored) {
      reply?.({ ok: true, code: room.code, restored: true });
      return;
    }
    if (seatedPlayers(room).length >= 8) {
      reply?.({ ok: false, error: "房间已满" });
      return;
    }
    joinRoom(socket, room, name, token);
    reply?.({ ok: true, code: room.code });
  });

  socket.on("startHand", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (room) startHand(room);
  });

  socket.on("toggleReady", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const player = room?.players.find((candidate) => candidate.id === socket.id);
    if (!room || !player || inPlayingPhase(room)) return;
    if (player.chips <= 0) {
      player.ready = false;
      room.message = `${player.name} 筹码为 0，请先买入`;
      emitRoom(room);
      return;
    }
    player.ready = !player.ready;
    room.message = player.ready ? `${player.name} 已准备` : `${player.name} 取消准备`;
    checkAutoStart(room);
  });

  socket.on("addBot", ({ code, buyIn }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) {
      reply?.({ ok: false, error: "找不到这个房间" });
      return;
    }
    if (seatedPlayers(room).length >= 8) {
      reply?.({ ok: false, error: "房间已满" });
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "showdown") {
      reply?.({ ok: false, error: "本手进行中不能加人机" });
      return;
    }
    const botBuyIn = normalizeBuyAmount(buyIn || room.botBuyIn || DEFAULT_BOT_BUY_IN);
    room.botBuyIn = botBuyIn;
    addBot(room, botBuyIn);
    room.message = `人机玩家已加入，筹码 ${botBuyIn}`;
    checkAutoStart(room);
    reply?.({ ok: true, buyIn: botBuyIn });
  });

  socket.on("setGameMode", ({ code, mode }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || inPlayingPhase(room)) return;
    room.gameMode = mode === "reward" ? "reward" : "normal";
    room.message = room.gameMode === "reward" ? "已切换到抢鱿鱼模式" : "已切换到常规模式";
    emitRoom(room);
  });

  socket.on("systemBuyIn", ({ code, amount }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const player = room?.players.find((candidate) => candidate.id === socket.id);
    if (!room || !player || player.inHand) {
      reply?.({ ok: false, error: "本手进行中不能买入" });
      return;
    }
    const buyAmount = normalizeBuyAmount(amount);
    player.chips += buyAmount;
    player.ready = false;
    room.message = `${player.name} 向系统买入 ${buyAmount}`;
    emitRoom(room);
    reply?.({ ok: true });
  });

  socket.on("requestBuyIn", ({ code, toSeat, amount }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const buyer = room?.players.find((candidate) => candidate.id === socket.id);
    const seller = room?.players.find((candidate) => candidate.seat === Number(toSeat));
    if (!room || !buyer || !seller || buyer.isBot || seller.isBot || seller.id === buyer.id) {
      reply?.({ ok: false, error: "请选择一名真人玩家" });
      return;
    }
    if (inPlayingPhase(room) || buyer.inHand || seller.inHand) {
      reply?.({ ok: false, error: "本手进行中不能向玩家买入" });
      return;
    }
    const buyAmount = normalizeBuyAmount(amount);
    if (seller.chips < buyAmount) {
      reply?.({ ok: false, error: "对方筹码不足" });
      return;
    }
    const request = {
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      fromId: buyer.id,
      toId: seller.id,
      fromSeat: buyer.seat,
      toSeat: seller.seat,
      fromName: buyer.name,
      toName: seller.name,
      amount: buyAmount,
      status: "pending",
    };
    room.buyRequests = room.buyRequests.filter((item) => item.status === "pending" && item.fromId !== buyer.id);
    room.buyRequests.push(request);
    room.message = `${buyer.name} 向 ${seller.name} 申请买入 ${buyAmount}`;
    emitRoom(room);
    reply?.({ ok: true });
  });

  socket.on("respondBuyIn", ({ code, requestId, accept }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const request = room?.buyRequests.find((item) => item.id === requestId && item.status === "pending");
    if (!room || !request || request.toId !== socket.id) {
      reply?.({ ok: false, error: "找不到买入申请" });
      return;
    }
    const buyer = room.players.find((player) => player.id === request.fromId);
    const seller = room.players.find((player) => player.id === request.toId);
    request.status = accept ? "accepted" : "declined";
    if (accept && buyer && seller && !buyer.inHand && !seller.inHand && seller.chips >= request.amount) {
      seller.chips -= request.amount;
      buyer.chips += request.amount;
      buyer.ready = false;
      if (seller.chips <= 0) seller.ready = false;
      room.message = `${seller.name} 同意，${buyer.name} 买入 ${request.amount}`;
    } else if (accept) {
      room.message = "买入失败：筹码不足或本手已开始";
    } else {
      room.message = `${seller?.name || "玩家"} 拒绝了买入申请`;
    }
    room.buyRequests = room.buyRequests.filter((item) => item.status === "pending");
    emitRoom(room);
    reply?.({ ok: true });
  });

  socket.on("action", ({ code, type, amount }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (room) act(room, socket, type, amount);
  });

  socket.on("chooseRunout", ({ code, choice }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (room) chooseRunout(room, socket, choice);
  });

  socket.on("voiceJoin", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.players.some((player) => player.id === socket.id && player.connected && !player.isBot)) return;
    socket.to(room.code).emit("voicePeerJoined", { id: socket.id });
  });

  socket.on("voiceLeave", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    socket.to(room.code).emit("voicePeerLeft", { id: socket.id });
  });

  socket.on("leaveRoom", ({ code }, reply) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) {
      reply?.({ ok: true });
      return;
    }
    const player = room.players.find((candidate) => candidate.id === socket.id && !candidate.isBot);
    if (!player) {
      reply?.({ ok: true });
      return;
    }
    leaveRoom(room, player, socket);
    reply?.({ ok: true });
  });

  socket.on("voiceSignal", ({ code, to, signal }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || typeof to !== "string" || !signal) return;
    const sender = room.players.find((player) => player.id === socket.id && player.connected && !player.isBot);
    const receiver = room.players.find((player) => player.id === to && player.connected && !player.isBot);
    if (!sender || !receiver) return;
    io.to(to).emit("voiceSignal", { from: socket.id, signal });
  });

  socket.on("disconnect", () => {
    rooms.forEach((room) => {
      const player = room.players.find((candidate) => candidate.id === socket.id);
      if (!player) return;
      socket.to(room.code).emit("voicePeerLeft", { id: socket.id });
      markPlayerDisconnected(room, player);
    });
  });
});

function joinRoom(socket, room, name, token) {
  socket.join(room.code);
  const usedSeats = new Set(room.players.map((player) => player.seat));
  const seat = Array.from({ length: 8 }, (_, index) => index).find((index) => !usedSeats.has(index));
  room.players.push({
    id: socket.id,
    token: String(token || socket.id),
    name: String(name || "玩家").slice(0, 16),
    seat,
    chips: STARTING_CHIPS,
    hand: [],
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    connected: true,
    reconnecting: false,
    inHand: false,
    ready: false,
    isBot: false,
  });
  room.message = `${name || "玩家"} 加入了房间`;
  emitRoom(room);
}

function restorePlayer(socket, room, name, token) {
  const normalizedName = String(name || "").trim();
  const normalizedToken = String(token || "");
  const player = room.players.find((candidate) => (
    !candidate.isBot &&
    (
      (normalizedToken && candidate.token === normalizedToken) ||
      (!candidate.connected && normalizedName && candidate.name === normalizedName)
    )
  ));
  if (!player) return false;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
  if (player.id !== socket.id) {
    room.buyRequests.forEach((request) => {
      if (request.fromId === player.id) request.fromId = socket.id;
      if (request.toId === player.id) request.toId = socket.id;
    });
  }
  player.id = socket.id;
  player.token = normalizedToken || player.token || socket.id;
  player.name = String(name || player.name).slice(0, 16);
  player.connected = true;
  player.reconnecting = false;
  socket.join(room.code);
  room.message = `${player.name} 已重新连接`;
  emitRoom(room);
  return true;
}

function markPlayerDisconnected(room, player) {
  player.connected = false;
  player.reconnecting = true;
  room.message = `${player.name} 断线，保留座位 30 秒`;
  emitRoom(room);

  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  player.reconnectTimer = setTimeout(() => {
    player.reconnectTimer = null;
    if (player.connected) return;
    player.reconnecting = false;
    if (player.inHand && !player.folded) {
      player.folded = true;
      room.message = `${player.name} 断线超时，自动弃牌`;
      if (room.turnSeat === player.seat) advanceGame(room);
      else emitRoom(room);
    } else {
      room.message = `${player.name} 已离线`;
      emitRoom(room);
    }
  }, DISCONNECT_GRACE_MS);
}

function leaveRoom(room, player, socket) {
  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
  socket.leave(room.code);
  socket.to(room.code).emit("voicePeerLeft", { id: socket.id });
  room.buyRequests = room.buyRequests.filter((request) => request.fromId !== player.id && request.toId !== player.id);

  if (player.inHand && inPlayingPhase(room)) {
    player.left = true;
    player.connected = false;
    player.reconnecting = false;
    player.ready = false;
    if (!player.folded) {
      player.folded = true;
      room.acted.add(player.seat);
    }
    room.message = `${player.name} 退出房间，自动弃牌`;
    if (room.turnSeat === player.seat) advanceGame(room);
    else emitRoom(room);
    return;
  }

  room.players = room.players.filter((candidate) => candidate !== player);
  room.message = `${player.name} 退出了房间`;
  if (room.players.some((candidate) => candidate.connected && !candidate.isBot)) {
    checkAutoStart(room);
  } else {
    rooms.delete(room.code);
  }
}

function addBot(room, buyIn = room.botBuyIn || DEFAULT_BOT_BUY_IN) {
  const usedSeats = new Set(room.players.map((player) => player.seat));
  const seat = Array.from({ length: 8 }, (_, index) => index).find((index) => !usedSeats.has(index));
  const botNames = ["阿河", "小盲侠", "牌桌助手", "松凶哥", "稳健哥", "河牌王"];
  const aiProfile = randomBotProfile();
  room.players.push({
    id: `bot-${room.code}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: botNames[Math.floor(Math.random() * botNames.length)],
    seat,
    chips: buyIn,
    hand: [],
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    connected: true,
    inHand: false,
    ready: true,
    isBot: true,
    aiProfile,
  });
}

function randomBotProfile() {
  const index = randomInt(0, BOT_PROFILES.length);
  const profile = { ...BOT_PROFILES[index] };
  profile.aggression = clamp(profile.aggression + randomOffset(0.09), 0.12, 0.94);
  profile.looseness = clamp(profile.looseness + randomOffset(0.09), 0.16, 0.88);
  profile.bluff = clamp(profile.bluff + randomOffset(0.055), 0.01, 0.34);
  profile.call = clamp(profile.call + randomOffset(0.08), 0.2, 0.72);
  profile.raiseThreshold = clamp(profile.raiseThreshold + randomOffset(0.045), 0.52, 0.84);
  profile.allInThreshold = clamp(profile.allInThreshold + randomOffset(0.025), 0.86, 0.98);
  profile.threeBet = clamp(profile.threeBet + randomOffset(0.055), 0.02, 0.32);
  return profile;
}

function randomOffset(range) {
  return (Math.random() * 2 - 1) * range;
}

server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((item) => item && item.family === "IPv4" && !item.internal)?.address;
  console.log(`Texas Poker running at http://localhost:${PORT}`);
  if (lan) console.log(`Phone URL on same Wi-Fi: http://${lan}:${PORT}`);
});
