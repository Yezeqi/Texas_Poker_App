import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const a = io("http://localhost:3000");
const b = io("http://localhost:3000");

await Promise.all([
  new Promise((resolve) => a.on("connect", resolve)),
  new Promise((resolve) => b.on("connect", resolve)),
]);

const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Alice" }, resolve));
await createdState;

const joinedStates = Promise.all([onceState(a), onceState(b)]);
const joinReply = await new Promise((resolve) => b.emit("joinRoom", { code: createReply.code, name: "Bob" }, resolve));
await joinedStates;

const readyState = onceState(a);
a.emit("toggleReady", { code: createReply.code });
await readyState;

const handStarted = onceState(a);
b.emit("toggleReady", { code: createReply.code });
const state = await handStarted;

console.log(JSON.stringify({
  createReply,
  joinReply,
  phase: state.phase,
  players: state.players.length,
  community: state.community.length,
  dealerSeat: state.dealerSeat,
  smallBlindSeat: state.smallBlindSeat,
  bigBlindSeat: state.bigBlindSeat,
  turnSeat: state.turnSeat,
  pot: state.pot,
}, null, 2));

a.close();
b.close();
