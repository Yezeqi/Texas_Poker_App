const joinScreen = document.querySelector("#join");
const tableScreen = document.querySelector("#table");
const nameInput = document.querySelector("#name");
const codeInput = document.querySelector("#code");
const serverInput = document.querySelector("#serverUrl");
const joinError = document.querySelector("#joinError");
const roomCodeButton = document.querySelector("#copyCode");
const playersEl = document.querySelector("#players");
const communityEl = document.querySelector("#community");
const potEl = document.querySelector("#pot");
const rewardPoolEl = document.querySelector("#rewardPool");
const messageEl = document.querySelector("#message");
const raiseInput = document.querySelector("#raiseAmount");
const buyAmountInput = document.querySelector("#buyAmount");
const buyTargetSelect = document.querySelector("#buyTarget");
const buyRequestsEl = document.querySelector("#buyRequests");
const runoutDialog = document.querySelector("#runoutDialog");
const buttons = {
  create: document.querySelector("#create"),
  join: document.querySelector("#joinRoom"),
  ready: document.querySelector("#ready"),
  addBot: document.querySelector("#addBot"),
  fold: document.querySelector("#fold"),
  checkCall: document.querySelector("#checkCall"),
  raise: document.querySelector("#raise"),
  allIn: document.querySelector("#allIn"),
  systemBuy: document.querySelector("#systemBuy"),
  requestBuy: document.querySelector("#requestBuy"),
  muteToggle: document.querySelector("#muteToggle"),
  voiceToggle: document.querySelector("#voiceToggle"),
  modeToggle: document.querySelector("#modeToggle"),
  runoutOnce: document.querySelector("#runoutOnce"),
  runoutTwice: document.querySelector("#runoutTwice"),
};

const DEFAULT_SERVER_URL = "https://play.texashg.xyz";
let state = null;
let socket = null;
let activeServerUrl = "";
let audioContext = null;
let audioUnlocked = false;
let speechUnlocked = false;
let previousState = null;
let muted = localStorage.getItem("pokerMuted") === "true";
localStorage.removeItem("pokerForcedLandscape");
const chipSound = new Audio("/sounds/falling-coin.mp3");
chipSound.preload = "auto";
const readySound = new Audio("/sounds/shuffle-cards.mp3");
readySound.preload = "auto";
const dealSound = new Audio("/sounds/deal-card.mp3");
dealSound.preload = "auto";
const checkSound = new Audio("/sounds/table-knock.mp3");
checkSound.preload = "auto";
let chipSoundBuffer = null;
let readySoundBuffer = null;
let dealSoundBuffer = null;
let checkSoundBuffer = null;
let voiceActive = false;
let voiceMuted = false;
let localVoiceStream = null;
let voiceHoldTriggered = false;
let lastAutoRejoinAt = 0;
const voicePeers = new Map();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const params = new URLSearchParams(location.search);
const savedName = localStorage.getItem("pokerName");
if (savedName) nameInput.value = savedName;
const playerToken = getPlayerToken();
const savedServerUrl = localStorage.getItem("pokerServerUrl");
const serverFromUrl = params.get("server");
serverInput.value = serverFromUrl || rememberedServerUrl(savedServerUrl) || defaultServerUrl();
connectSocket();

const codeFromUrl = params.get("room");
if (codeFromUrl) {
  codeInput.value = codeFromUrl.toUpperCase();
  rememberRoomCode(codeInput.value);
}
renderMuteButton();
renderVoiceButton();

document.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
document.addEventListener("touchstart", unlockAudio, { once: true, passive: true });
window.addEventListener("beforeunload", () => stopVoiceChat());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") autoRejoinRoom("visible");
});
window.addEventListener("focus", () => autoRejoinRoom("focus"));

buttons.create.addEventListener("click", () => {
  unlockAudio();
  if (!ensureSocket()) return;
  const name = playerName();
  socket.emit("createRoom", { name, token: playerToken }, handleJoin);
});

buttons.join.addEventListener("click", () => {
  unlockAudio();
  if (!ensureSocket()) return;
  const name = playerName();
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    joinError.textContent = "请输入房间码";
    return;
  }
  socket.emit("joinRoom", { code, name, token: playerToken }, handleJoin);
});

buttons.ready.addEventListener("click", () => {
  unlockAudio();
  socket.emit("toggleReady", { code: state?.code });
});
buttons.addBot.addEventListener("click", () => {
  unlockAudio();
  socket.emit("addBot", { code: state?.code });
});
buttons.fold.addEventListener("click", () => sendAction("fold"));
buttons.checkCall.addEventListener("click", () => sendAction("checkCall"));
buttons.raise.addEventListener("click", () => sendAction("raise", Number(raiseInput.value)));
buttons.allIn.addEventListener("click", () => sendAction("allIn"));
buttons.muteToggle.addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem("pokerMuted", String(muted));
  if (muted && "speechSynthesis" in window) window.speechSynthesis.cancel();
  renderMuteButton();
});
buttons.voiceToggle.addEventListener("click", () => {
  if (voiceHoldTriggered) {
    voiceHoldTriggered = false;
    return;
  }
  if (!voiceActive) startVoiceChat();
  else toggleVoiceMute();
});
buttons.modeToggle.addEventListener("click", () => {
  if (!state || !socket) return;
  const nextMode = state.gameMode === "reward" ? "normal" : "reward";
  socket.emit("setGameMode", { code: state.code, mode: nextMode });
});
buttons.systemBuy.addEventListener("click", () => {
  unlockAudio();
  if (!state || !socket) return;
  socket.emit("systemBuyIn", { code: state.code, amount: Number(buyAmountInput.value) }, handleJoin);
});
buttons.requestBuy.addEventListener("click", () => {
  unlockAudio();
  if (!state || !socket || !buyTargetSelect.value) return;
  socket.emit("requestBuyIn", {
    code: state.code,
    toSeat: Number(buyTargetSelect.value),
    amount: Number(buyAmountInput.value),
  }, handleJoin);
});
buttons.runoutOnce.addEventListener("click", () => chooseRunout("once"));
buttons.runoutTwice.addEventListener("click", () => chooseRunout("twice"));
buyRequestsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-request-id]");
  if (!button || !state || !socket) return;
  unlockAudio();
  socket.emit("respondBuyIn", {
    code: state.code,
    requestId: button.dataset.requestId,
    accept: button.dataset.accept === "true",
  }, handleJoin);
});
roomCodeButton.addEventListener("click", async () => {
  const url = `${activeServerUrl || location.origin}${location.pathname}?room=${state.code}`;
  await navigator.clipboard?.writeText(url);
  messageEl.textContent = "房间链接已复制";
});

function playerName() {
  const name = nameInput.value.trim() || `玩家${Math.floor(Math.random() * 90 + 10)}`;
  localStorage.setItem("pokerName", name);
  return name;
}

function getPlayerToken() {
  const existing = localStorage.getItem("pokerPlayerToken");
  if (existing) return existing;
  const token = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("pokerPlayerToken", token);
  return token;
}

function rememberRoomCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized) localStorage.setItem("pokerLastRoomCode", normalized);
}

function rememberedRoomCode() {
  return String(state?.code || codeInput.value || localStorage.getItem("pokerLastRoomCode") || "").trim().toUpperCase();
}

function defaultServerUrl() {
  return DEFAULT_SERVER_URL;
}

function rememberedServerUrl(value) {
  const url = normalizeServerUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.")) return "";
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return "";
  } catch {
    return "";
  }
  return url;
}

function normalizeServerUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}

function ensureSocket() {
  const serverUrl = normalizeServerUrl(serverInput.value || defaultServerUrl());
  if (!serverUrl) {
    joinError.textContent = "请先填写服务器地址";
    return false;
  }
  localStorage.setItem("pokerServerUrl", serverUrl);
  if (serverUrl !== activeServerUrl) connectSocket(serverUrl);
  return true;
}

function connectSocket(nextUrl = normalizeServerUrl(serverInput.value || defaultServerUrl())) {
  if (!nextUrl) return;
  activeServerUrl = nextUrl;
  if (socket) {
    stopVoiceChat(false);
    socket.disconnect();
  }
  socket = io(activeServerUrl, {
    transports: ["websocket", "polling"],
  });
  socket.on("connect_error", () => {
    joinError.textContent = `连接服务器失败：${activeServerUrl}`;
  });
  socket.on("connect", () => {
    joinError.textContent = "";
    autoRejoinRoom("connect");
  });
  socket.on("state", (nextState) => {
    const lastState = state;
    state = nextState;
    rememberRoomCode(state.code);
    if (shouldResetRaiseInput(lastState, state)) resetRaiseInputForState(state);
    joinScreen.classList.add("hidden");
    tableScreen.classList.remove("hidden");
  if (location.protocol.startsWith("http")) history.replaceState(null, "", `?room=${state.code}`);
    render();
    announceReadyChanges(lastState, state);
    announceCommunityChanges(lastState, state);
    announceCheckChanges(lastState, state);
    announceBetChanges(lastState, state);
    previousState = state;
  });
  socket.on("voicePeerJoined", ({ id }) => {
    if (voiceActive && id && id !== socket.id) createVoicePeer(id, true);
  });
  socket.on("voicePeerLeft", ({ id }) => {
    closeVoicePeer(id);
  });
  socket.on("voiceSignal", ({ from, signal }) => {
    handleVoiceSignal(from, signal);
  });
}

function autoRejoinRoom(reason = "auto") {
  const code = rememberedRoomCode();
  if (!code || !socket) return;
  if (!socket.connected) {
    socket.connect();
    return;
  }
  const now = Date.now();
  if (now - lastAutoRejoinAt < 1500) return;
  lastAutoRejoinAt = now;
  socket.emit("joinRoom", { code, name: playerName(), token: playerToken }, (reply) => {
    if (reply?.ok) {
      rememberRoomCode(reply.code || code);
      joinError.textContent = "";
    } else if (reason !== "connect") {
      joinError.textContent = reply?.error || joinError.textContent;
    }
  });
}

function handleJoin(reply) {
  if (reply?.ok) {
    if (reply.code) rememberRoomCode(reply.code);
    joinError.textContent = "";
    return;
  }
  if (!reply?.ok) {
    joinError.textContent = reply?.error || "进入房间失败";
  }
}

function sendAction(type, amount) {
  if (!state || !socket) return;
  unlockAudio();
  socket.emit("action", { code: state.code, type, amount });
  resetRaiseInputForState(state);
}

function chooseRunout(choice) {
  if (!state || !socket) return;
  unlockAudio();
  socket.emit("chooseRunout", { code: state.code, choice });
}

function render() {
  roomCodeButton.textContent = state.code;
  potEl.textContent = state.pot;
  rewardPoolEl.classList.toggle("hidden", state.gameMode !== "reward");
  rewardPoolEl.querySelector("strong").textContent = state.rewardPool || 0;
  messageEl.textContent = winnerText() || state.message;
  const tablePlayers = playersForTable();
  playersEl.innerHTML = tablePlayers.map((player, index) => renderPlayer(player, index, tablePlayers.length)).join("");
  communityEl.innerHTML = renderCommunity();
  renderBuyTargets();
  renderBuyRequests();
  renderRunoutDialog();

  const me = state.players.find((player) => player.seat === state.meSeat);
  const isMyTurn = state.turnSeat === state.meSeat;
  const inHand = ["preflop", "flop", "turn", "river", "runoutChoice"].includes(state.phase);
  const inLobby = state.phase === "lobby" || state.phase === "showdown";
  const canRaise = isMyTurn && me && me.chips > 0;
  buttons.fold.disabled = !isMyTurn;
  buttons.checkCall.disabled = !isMyTurn;
  buttons.raise.disabled = !canRaise;
  buttons.allIn.disabled = !isMyTurn;
  buttons.ready.disabled = inHand || !me || me.chips <= 0;
  buttons.addBot.disabled = !inLobby || state.players.length >= 8;
  buttons.modeToggle.disabled = !inLobby;
  buttons.modeToggle.textContent = state.gameMode === "reward" ? "抢鱿鱼" : "常规";
  buttons.voiceToggle.disabled = !state?.code;
  buttons.systemBuy.disabled = !me || me.inHand;
  buttons.requestBuy.disabled = !me || me.inHand || !buyTargetSelect.value;
  buttons.ready.textContent = me?.ready ? "取消准备" : "准备";
  buttons.checkCall.textContent = state.toCall > 0 ? `跟注 ${state.toCall}` : "过牌";
  raiseInput.min = 1;
  raiseInput.max = Math.max(1, me?.chips || 1);
  const currentRaise = Math.floor(Number(raiseInput.value) || 0);
  if (currentRaise < 1) raiseInput.value = defaultRaiseAmount(state, me);
  else if (me?.chips && currentRaise > me.chips) raiseInput.value = me.chips;
}

function shouldResetRaiseInput(lastState, nextState) {
  if (!nextState) return false;
  const nextMe = nextState.players?.find((player) => player.seat === nextState.meSeat);
  if (!nextMe) return false;
  if (!lastState || lastState.code !== nextState.code) return true;
  const phaseChanged = lastState.phase !== nextState.phase;
  const myTurnStarted = nextState.turnSeat === nextState.meSeat
    && (lastState.turnSeat !== nextState.meSeat || phaseChanged || lastState.currentBet !== nextState.currentBet);
  const myTurnEnded = lastState.turnSeat === lastState.meSeat && nextState.turnSeat !== nextState.meSeat;
  return phaseChanged || myTurnStarted || myTurnEnded;
}

function resetRaiseInputForState(nextState) {
  if (!nextState) return;
  const me = nextState.players?.find((player) => player.seat === nextState.meSeat);
  raiseInput.value = defaultRaiseAmount(nextState, me);
}

function defaultRaiseAmount(nextState, me) {
  const chips = Math.max(1, Number(me?.chips) || 1);
  const bigBlind = Math.max(1, Number(nextState?.bigBlind) || 1);
  return Math.min(chips, bigBlind);
}

function renderCommunity() {
  const runs = state.communityRuns?.length ? state.communityRuns : [state.community || []];
  return runs.map((cards, index) => `
    <div class="community-run ${runs.length > 1 ? "" : "single"}">
      ${runs.length > 1 ? `<span class="run-label">第${index + 1}次</span>` : ""}
      <div class="community-cards">${cards.map(renderCard).join("")}</div>
    </div>
  `).join("");
}

function renderRunoutDialog() {
  const visible = Boolean(state.runoutPrompt);
  runoutDialog.classList.toggle("hidden", !visible);
  buttons.runoutOnce.disabled = !visible;
  buttons.runoutTwice.disabled = !visible;
}

function renderBuyTargets() {
  const current = buyTargetSelect.value;
  const options = state.players
    .filter((player) => player.seat !== state.meSeat && !player.isBot && player.connected && !player.inHand && player.chips > 0)
    .map((player) => `<option value="${player.seat}">${escapeHtml(player.name)} (${player.chips})</option>`);
  buyTargetSelect.innerHTML = options.length ? options.join("") : '<option value="">无可申请玩家</option>';
  if ([...buyTargetSelect.options].some((option) => option.value === current)) buyTargetSelect.value = current;
}

function renderBuyRequests() {
  const requests = state.buyRequests || [];
  buyRequestsEl.innerHTML = requests.map((request) => {
    if (request.direction === "incoming") {
      return `
        <div class="buy-request">
          <span>${escapeHtml(request.fromName)} 申请向你买入 ${request.amount}</span>
          <button data-request-id="${request.id}" data-accept="true">同意</button>
          <button class="danger" data-request-id="${request.id}" data-accept="false">拒绝</button>
        </div>
      `;
    }
    return `
      <div class="buy-request muted">
        等待 ${escapeHtml(request.toName)} 同意买入 ${request.amount}
      </div>
    `;
  }).join("");
}

function playersForTable() {
  return [...state.players].sort((a, b) => displaySeat(a.seat) - displaySeat(b.seat));
}

function renderPlayer(player, index, count) {
  const seatPosition = dynamicSeatPosition(index, count);
  const classes = ["player", "dynamic-seat"];
  if (seatPosition.y < 50) classes.push("seat-top");
  else classes.push("seat-bottom");
  if (player.seat === state.meSeat) classes.push("me");
  if (isConcealedOpponent(player)) classes.push("concealed-opponent");
  if (isBettingPhase()) classes.push("betting-focus");
  if (player.bet > 0) classes.push("has-bet");
  if (state.turnSeat === player.seat) classes.push("turn");
  if (player.folded) classes.push("folded");
  const status = player.allIn
    ? "全下"
    : player.reconnecting
      ? "重连中"
      : player.folded
      ? "弃牌"
      : player.inHand
        ? ""
        : player.ready
          ? "已准备"
          : "未准备";
  const botBadge = player.isBot ? '<span class="bot-badge">AI</span>' : "";
  const roleBadges = renderRoleBadges(player);
  return `
    <article class="${classes.join(" ")}" style="--seat-x:${seatPosition.x}%; --seat-y:${seatPosition.y}%; --seat-anchor-x:${seatPosition.anchorX}%; --seat-anchor-y:${seatPosition.anchorY}%;">
      <div class="player-name"><span class="player-name-text">${escapeHtml(player.name)}</span>${botBadge}${roleBadges}</div>
      <div class="stack">筹码 ${player.chips} ${status}</div>
      <div class="bet">${player.bet ? `下注 ${player.bet}` : ""}</div>
      <div class="cards">${player.hand.map(renderCard).join("")}</div>
    </article>
  `;
}

function dynamicSeatPosition(index, count) {
  if (count <= 1) return { x: 50, y: 72, anchorX: -50, anchorY: -50 };
  const angle = (Math.PI / 2) - (index * 2 * Math.PI / count);
  const x = 50 + Math.cos(angle) * 42;
  const y = 50 + Math.sin(angle) * 39;
  return {
    x: Math.max(8, Math.min(92, x)),
    y: Math.max(20, Math.min(82, y)),
    anchorX: -50,
    anchorY: -50,
  };
}

function isBettingPhase() {
  return ["preflop", "flop", "turn", "river", "runoutChoice"].includes(state.phase);
}

function isConcealedOpponent(player) {
  return isBettingPhase() && player.seat !== state.meSeat && player.hand.every((card) => card === "back");
}

function displaySeat(seat) {
  if (state.meSeat === null || state.meSeat === undefined) return seat;
  return (seat - state.meSeat + 8) % 8;
}

function renderRoleBadges(player) {
  const badges = [];
  if (state.dealerSeat === player.seat) badges.push('<span class="role-badge dealer">D</span>');
  if (state.smallBlindSeat === player.seat) badges.push('<span class="role-badge small-blind">SB</span>');
  if (state.bigBlindSeat === player.seat) badges.push('<span class="role-badge big-blind">BB</span>');
  return badges.join("");
}

function renderCard(card) {
  if (!card) return "";
  if (card === "back") return '<span class="card back">?</span>';
  const rank = card[0].replace("T", "10");
  const suit = { s: "♠", h: "♥", d: "♦", c: "♣" }[card[1]];
  const red = card[1] === "h" || card[1] === "d";
  return `<span class="card ${red ? "red" : ""}">${rank}${suit}</span>`;
}

function winnerText() {
  if (!state.winners?.length) return "";
  return state.winners.map((winner) => `${winner.name} +${winner.amount} (${winner.hand})`).join("，");
}

function unlockAudio() {
  if (audioUnlocked) return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioCtor && !audioContext) audioContext = new AudioCtor();
  audioContext?.resume?.();
  chipSound.load();
  readySound.load();
  dealSound.load();
  checkSound.load();
  loadSoundBuffers();
  unlockSpeech();
  audioUnlocked = true;
}

function playChipSound() {
  if (!audioUnlocked || muted) return;
  playSound(chipSoundBuffer, chipSound, 0.82);
}

function playReadySound() {
  if (!audioUnlocked || muted) return;
  playSound(readySoundBuffer, readySound, 0.78);
}

function playDealSound() {
  if (!audioUnlocked || muted) return;
  playSound(dealSoundBuffer, dealSound, 0.86);
}

function playCheckSound() {
  if (!audioUnlocked || muted) return;
  playSound(checkSoundBuffer, checkSound, 0.86);
}

async function loadSoundBuffers() {
  if (!audioContext) return;
  chipSoundBuffer ||= await decodeSound("/sounds/falling-coin.mp3");
  readySoundBuffer ||= await decodeSound("/sounds/shuffle-cards.mp3");
  dealSoundBuffer ||= await decodeSound("/sounds/deal-card.mp3");
  checkSoundBuffer ||= await decodeSound("/sounds/table-knock.mp3");
}

async function decodeSound(url) {
  try {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    return await audioContext.decodeAudioData(data);
  } catch {
    return null;
  }
}

function playSound(buffer, fallbackAudio, volume) {
  if (buffer && audioContext) {
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(audioContext.destination);
    source.start();
    return;
  }
  const sound = fallbackAudio.cloneNode();
  sound.volume = volume;
  sound.play().catch(() => {});
}

function announceBetChanges(lastState, nextState) {
  if (!lastState || !nextState || lastState.code !== nextState.code) return;
  const lastPlayers = new Map(lastState.players.map((player) => [player.seat, player]));
  const changes = nextState.players
    .map((player) => {
      const lastPlayer = lastPlayers.get(player.seat);
      const previousBet = lastPlayer?.bet || 0;
      const delta = player.bet - previousBet;
      return { player, previousBet, delta };
    })
    .filter((item) => item.delta > 0 && item.player.seat !== nextState.meSeat);

  if (!changes.length) return;
  playChipSound();
  changes.forEach(({ player, previousBet, delta }) => {
    speakBet(player, previousBet, delta);
  });
}

function announceReadyChanges(lastState, nextState) {
  if (!lastState || !nextState || lastState.code !== nextState.code) return;
  const handJustStarted = (lastState.phase === "lobby" || lastState.phase === "showdown") && nextState.phase === "preflop";
  const lastPlayers = new Map(lastState.players.map((player) => [player.seat, player]));
  const hasNewReadyPlayer = nextState.players.some((player) => {
    const lastPlayer = lastPlayers.get(player.seat);
    return !player.isBot && player.ready && !lastPlayer?.ready;
  });
  if (hasNewReadyPlayer || handJustStarted) playReadySound();
}

function announceCommunityChanges(lastState, nextState) {
  if (!lastState || !nextState || lastState.code !== nextState.code) return;
  const lastCount = lastState.community?.length || 0;
  const nextCount = nextState.community?.length || 0;
  const lastRunCount = lastState.communityRuns?.reduce((sum, cards) => sum + cards.length, 0) || 0;
  const nextRunCount = nextState.communityRuns?.reduce((sum, cards) => sum + cards.length, 0) || 0;
  if ((nextCount > lastCount && [3, 4, 5].includes(nextCount)) || nextRunCount > lastRunCount) playDealSound();
}

function announceCheckChanges(lastState, nextState) {
  if (!lastState || !nextState || lastState.code !== nextState.code || lastState.message === nextState.message) return;
  if (!nextState.message.endsWith(" 过牌")) return;
  const checker = nextState.players.find((player) => nextState.message === `${player.name} 过牌`);
  if (checker && checker.seat !== nextState.meSeat) playCheckSound();
}

function speakBet(player, previousBet, delta) {
  if (!audioUnlocked || muted || !("speechSynthesis" in window) || !speechUnlocked) return;
  const text = String(delta);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  const voice = selectChineseVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  utterance.volume = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume?.();
  window.speechSynthesis.speak(utterance);
}

function renderMuteButton() {
  buttons.muteToggle.textContent = muted ? "静音" : "有声";
  buttons.muteToggle.classList.toggle("muted", muted);
  buttons.muteToggle.title = muted ? "点击开启声音" : "点击静音";
}

function renderVoiceButton() {
  if (!buttons.voiceToggle) return;
  if (!voiceActive) {
    buttons.voiceToggle.textContent = "语音";
    buttons.voiceToggle.classList.remove("active", "muted");
    buttons.voiceToggle.title = "开启语音聊天";
    return;
  }
  buttons.voiceToggle.textContent = voiceMuted ? "闭麦" : "麦开";
  buttons.voiceToggle.classList.toggle("active", !voiceMuted);
  buttons.voiceToggle.classList.toggle("muted", voiceMuted);
  buttons.voiceToggle.title = voiceMuted ? "点击打开麦克风，长按关闭语音" : "点击闭麦，长按关闭语音";
}

async function startVoiceChat() {
  if (!state?.code || !socket || voiceActive) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    messageEl.textContent = "当前环境不支持语音聊天";
    return;
  }
  try {
    localVoiceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    messageEl.textContent = "无法打开麦克风，请检查权限";
    return;
  }
  voiceActive = true;
  voiceMuted = false;
  renderVoiceButton();
  socket.emit("voiceJoin", { code: state.code });
}

function toggleVoiceMute() {
  if (!voiceActive) return;
  voiceMuted = !voiceMuted;
  localVoiceStream?.getAudioTracks().forEach((track) => {
    track.enabled = !voiceMuted;
  });
  renderVoiceButton();
}

buttons.voiceToggle.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  stopVoiceChat();
});

buttons.voiceToggle.addEventListener("pointerdown", () => {
  clearTimeout(buttons.voiceToggle.voiceHoldTimer);
  buttons.voiceToggle.voiceHoldTimer = setTimeout(() => {
    voiceHoldTriggered = true;
    stopVoiceChat();
  }, 700);
});

buttons.voiceToggle.addEventListener("pointerup", () => {
  clearTimeout(buttons.voiceToggle.voiceHoldTimer);
});

function stopVoiceChat(notify = true) {
  if (notify && voiceActive && socket && state?.code) socket.emit("voiceLeave", { code: state.code });
  voicePeers.forEach((peer) => closeVoicePeer(peer.id));
  localVoiceStream?.getTracks().forEach((track) => track.stop());
  localVoiceStream = null;
  voiceActive = false;
  voiceMuted = false;
  renderVoiceButton();
}

function createVoicePeer(id, initiator = false) {
  if (!voiceActive || !localVoiceStream || !socket || !state?.code || id === socket.id) return null;
  const existing = voicePeers.get(id);
  if (existing) return existing.pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const peer = { id, pc, audio: null };
  voicePeers.set(id, peer);

  localVoiceStream.getTracks().forEach((track) => pc.addTrack(track, localVoiceStream));
  pc.onicecandidate = (event) => {
    if (event.candidate) sendVoiceSignal(id, { type: "ice", candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    if (!peer.audio) {
      peer.audio = new Audio();
      peer.audio.autoplay = true;
      peer.audio.playsInline = true;
      document.body.appendChild(peer.audio);
    }
    peer.audio.srcObject = event.streams[0];
    peer.audio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (["closed", "failed", "disconnected"].includes(pc.connectionState)) closeVoicePeer(id);
  };

  if (initiator) {
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => sendVoiceSignal(id, { type: "description", description: pc.localDescription }))
      .catch(() => closeVoicePeer(id));
  }

  return pc;
}

async function handleVoiceSignal(from, signal) {
  if (!voiceActive || !from || !signal) return;
  const pc = createVoicePeer(from, false);
  if (!pc) return;
  try {
    if (signal.type === "description") {
      await pc.setRemoteDescription(signal.description);
      if (signal.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendVoiceSignal(from, { type: "description", description: pc.localDescription });
      }
    } else if (signal.type === "ice" && signal.candidate) {
      await pc.addIceCandidate(signal.candidate);
    }
  } catch (error) {
    closeVoicePeer(from);
  }
}

function sendVoiceSignal(to, signal) {
  if (!socket || !state?.code) return;
  socket.emit("voiceSignal", { code: state.code, to, signal });
}

function closeVoicePeer(id) {
  const peer = voicePeers.get(id);
  if (!peer) return;
  peer.pc.close();
  peer.audio?.remove();
  voicePeers.delete(id);
}

function unlockSpeech() {
  if (speechUnlocked || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.resume?.();
  const warmup = new SpeechSynthesisUtterance("。");
  warmup.lang = "zh-CN";
  warmup.volume = 0.01;
  const voice = selectChineseVoice();
  if (voice) warmup.voice = voice;
  window.speechSynthesis.speak(warmup);
  speechUnlocked = true;
}

function selectChineseVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => /zh|中文|Chinese|普通话|Mandarin/i.test(`${voice.lang} ${voice.name}`)) || voices[0] || null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
