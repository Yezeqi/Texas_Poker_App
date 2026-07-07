import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const token = `reconnect-${Date.now()}`;
const a = io("http://localhost:3000");

await new Promise((resolve) => a.on("connect", resolve));
const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Alice", token }, resolve));
const firstState = await createdState;
const firstSeat = firstState.meSeat;
a.close();

await new Promise((resolve) => setTimeout(resolve, 300));

const reconnected = io("http://localhost:3000");
await new Promise((resolve) => reconnected.on("connect", resolve));
const restoredState = onceState(reconnected);
const joinReply = await new Promise((resolve) => {
  reconnected.emit("joinRoom", { code: createReply.code, name: "Alice", token }, resolve);
});
const finalState = await restoredState;

console.log(JSON.stringify({
  createReply,
  joinReply,
  firstSeat,
  restoredSeat: finalState.meSeat,
  players: finalState.players.length,
  chips: finalState.players.find((player) => player.seat === finalState.meSeat)?.chips,
}, null, 2));

reconnected.close();
