import { io } from "socket.io-client";

const waitForState = (client, predicate, timeoutMs = 5000, label = "state") => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    client.off("state", onState);
    reject(new Error(`Timed out waiting for ${label}`));
  }, timeoutMs);
  function onState(state) {
    if (!predicate(state)) return;
    clearTimeout(timer);
    client.off("state", onState);
    resolve(state);
  }
  client.on("state", onState);
});

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const emitAck = (client, event, payload) => new Promise((resolve) => client.emit(event, payload, resolve));

async function connectPlayers(prefix) {
  const a = io("http://localhost:3000");
  const b = io("http://localhost:3000");
  await Promise.all([
    new Promise((resolve) => a.on("connect", resolve)),
    new Promise((resolve) => b.on("connect", resolve)),
  ]);

  const createdState = onceState(a);
  const createReply = await emitAck(a, "createRoom", { name: "Alice", token: `${prefix}-a` });
  await createdState;

  const joinedStates = Promise.all([onceState(a), onceState(b)]);
  await emitAck(b, "joinRoom", { code: createReply.code, name: "Bob", token: `${prefix}-b` });
  await joinedStates;

  return { a, b, code: createReply.code };
}

async function startHeadsUpHand(a, b, code) {
  const readyState = onceState(a);
  a.emit("toggleReady", { code });
  await readyState;
  const handStarted = waitForState(a, (state) => state.phase === "preflop", 5000, "hand start");
  b.emit("toggleReady", { code });
  return handStarted;
}

const foldRoom = await connectPlayers("fold-hide");
const foldPreflop = await startHeadsUpHand(foldRoom.a, foldRoom.b, foldRoom.code);
const folderSeat = foldPreflop.turnSeat;
const folder = foldPreflop.players.find((player) => player.seat === folderSeat);
const folderClient = folder.name === "Alice" ? foldRoom.a : foldRoom.b;
const observerClient = folder.name === "Alice" ? foldRoom.b : foldRoom.a;
const foldedShowdown = waitForState(observerClient, (state) => state.phase === "showdown", 5000, "fold showdown");
folderClient.emit("action", { code: foldRoom.code, type: "fold" });
const foldState = await foldedShowdown;
const hiddenFolder = foldState.players.find((player) => player.name === folder.name);
if (!hiddenFolder.hand.every((card) => card === "back")) {
  throw new Error("Folded player hand was revealed after everyone else folded");
}
foldRoom.a.close();
foldRoom.b.close();

const allInRoom = await connectPlayers("side-pot");
await emitAck(allInRoom.a, "systemBuyIn", { code: allInRoom.code, amount: 800 });
await emitAck(allInRoom.b, "systemBuyIn", { code: allInRoom.code, amount: 2800 });
const allInPreflop = await startHeadsUpHand(allInRoom.a, allInRoom.b, allInRoom.code);
const alicePreflop = allInPreflop.players.find((player) => player.name === "Alice");
const bobPreflop = allInPreflop.players.find((player) => player.name === "Bob");
if (alicePreflop.chips + alicePreflop.bet !== 1000 || bobPreflop.chips + bobPreflop.bet !== 3000) {
  throw new Error("Unexpected buy-in setup for side pot smoke test");
}

const firstActor = allInPreflop.players.find((player) => player.seat === allInPreflop.turnSeat);
const firstClient = firstActor.name === "Alice" ? allInRoom.a : allInRoom.b;
const secondClient = firstActor.name === "Alice" ? allInRoom.b : allInRoom.a;
const secondTurn = waitForState(secondClient, (state) => (
  state.phase === "preflop" &&
  state.turnSeat === state.meSeat &&
  state.players.find((player) => player.name === firstActor.name)?.allIn
), 5000, "second all-in turn");
firstClient.emit("action", { code: allInRoom.code, type: "allIn" });
await secondTurn;

const runoutPrompt = waitForState(allInRoom.a, (state) => state.phase === "runoutChoice" && state.runoutPrompt, 5000, "runout prompt");
secondClient.emit("action", { code: allInRoom.code, type: "allIn" });
await runoutPrompt;
const allInShowdown = waitForState(allInRoom.a, (state) => state.phase === "showdown" && state.community.length === 5, 5000, "all-in showdown");
allInRoom.a.emit("chooseRunout", { code: allInRoom.code, choice: "once" });
const allInState = await allInShowdown;
const aliceFinal = allInState.players.find((player) => player.name === "Alice");
const bobFinal = allInState.players.find((player) => player.name === "Bob");
if (aliceFinal.chips > 2000 || bobFinal.chips < 2000 || aliceFinal.chips + bobFinal.chips !== 4000) {
  throw new Error("Side pot settlement did not preserve the unmatched all-in amount");
}
allInRoom.a.close();
allInRoom.b.close();

const twiceRoom = await connectPlayers("run-twice");
const twicePreflop = await startHeadsUpHand(twiceRoom.a, twiceRoom.b, twiceRoom.code);
const twiceFirstActor = twicePreflop.players.find((player) => player.seat === twicePreflop.turnSeat);
const twiceFirstClient = twiceFirstActor.name === "Alice" ? twiceRoom.a : twiceRoom.b;
const twiceSecondClient = twiceFirstActor.name === "Alice" ? twiceRoom.b : twiceRoom.a;
const twiceSecondTurn = waitForState(twiceSecondClient, (state) => (
  state.phase === "preflop" &&
  state.turnSeat === state.meSeat &&
  state.players.find((player) => player.name === twiceFirstActor.name)?.allIn
), 5000, "second all-in turn for twice");
twiceFirstClient.emit("action", { code: twiceRoom.code, type: "allIn" });
await twiceSecondTurn;
const twicePromptA = waitForState(twiceRoom.a, (state) => state.phase === "runoutChoice" && state.runoutPrompt, 5000, "first run twice prompt");
const twicePromptB = waitForState(twiceRoom.b, (state) => state.phase === "runoutChoice" && state.runoutPrompt, 5000, "second run twice prompt");
twiceSecondClient.emit("action", { code: twiceRoom.code, type: "allIn" });
await Promise.all([twicePromptA, twicePromptB]);
const twiceShowdown = waitForState(twiceRoom.a, (state) => (
  state.phase === "showdown" &&
  state.communityRuns?.length === 2 &&
  state.communityRuns.every((cards) => cards.length === 5)
), 5000, "run twice showdown");
twiceRoom.a.emit("chooseRunout", { code: twiceRoom.code, choice: "twice" });
twiceRoom.b.emit("chooseRunout", { code: twiceRoom.code, choice: "twice" });
const twiceState = await twiceShowdown;
twiceRoom.a.close();
twiceRoom.b.close();

console.log(JSON.stringify({
  foldWinnerMessage: foldState.message,
  foldedHandSeenByOpponent: hiddenFolder.hand,
  allInCommunityCards: allInState.community.length,
  aliceFinalChips: aliceFinal.chips,
  bobFinalChips: bobFinal.chips,
  runTwiceBoards: twiceState.communityRuns.map((cards) => cards.length),
  winners: allInState.winners,
}, null, 2));
