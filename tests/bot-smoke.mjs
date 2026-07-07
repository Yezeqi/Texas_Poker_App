import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const a = io("http://localhost:3000");

await new Promise((resolve) => a.on("connect", resolve));

const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Solo" }, resolve));
await createdState;

const botJoined = onceState(a);
a.emit("addBot", { code: createReply.code });
await botJoined;

const ready = onceState(a);
a.emit("toggleReady", { code: createReply.code });
const state = await ready;

console.log(JSON.stringify({
  createReply,
  phase: state.phase,
  dealerSeat: state.dealerSeat,
  smallBlindSeat: state.smallBlindSeat,
  bigBlindSeat: state.bigBlindSeat,
  players: state.players.map((player) => ({ name: player.name, isBot: player.isBot, ready: player.ready })),
  pot: state.pot,
}, null, 2));

a.close();
