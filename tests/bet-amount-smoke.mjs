import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const waitForState = (client, predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    client.off("state", onState);
    reject(new Error("Timed out waiting for state"));
  }, timeoutMs);
  function onState(state) {
    if (!predicate(state)) return;
    clearTimeout(timer);
    client.off("state", onState);
    resolve(state);
  }
  client.on("state", onState);
});

const a = io("http://localhost:3000");
const b = io("http://localhost:3000");

await Promise.all([
  new Promise((resolve) => a.on("connect", resolve)),
  new Promise((resolve) => b.on("connect", resolve)),
]);

const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Alice", token: "bet-a" }, resolve));
await createdState;

const joinedStates = Promise.all([onceState(a), onceState(b)]);
await new Promise((resolve) => b.emit("joinRoom", { code: createReply.code, name: "Bob", token: "bet-b" }, resolve));
await joinedStates;

const readyState = onceState(a);
a.emit("toggleReady", { code: createReply.code });
await readyState;

const handStarted = waitForState(a, (state) => state.phase === "preflop" && state.turnSeat === state.meSeat);
b.emit("toggleReady", { code: createReply.code });
await handStarted;

const raised = waitForState(a, (state) => state.players.find((player) => player.name === "Alice")?.bet === 8);
a.emit("action", { code: createReply.code, type: "raise", amount: 7 });
const state = await raised;

console.log(JSON.stringify({
  createReply,
  aliceBet: state.players.find((player) => player.name === "Alice")?.bet,
  currentBet: state.currentBet,
  pot: state.pot,
}, null, 2));

a.close();
b.close();
