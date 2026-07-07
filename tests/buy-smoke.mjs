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
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Alice" }, resolve));
let stateA = await createdState;

const joinedStates = Promise.all([onceState(a), onceState(b)]);
await new Promise((resolve) => b.emit("joinRoom", { code: createReply.code, name: "Bob" }, resolve));
await joinedStates;

const systemBuyState = onceState(a);
a.emit("systemBuyIn", { code: createReply.code, amount: 300 });
stateA = await systemBuyState;

const bob = stateA.players.find((player) => player.name === "Bob");
const requestStateForB = waitForState(b, (state) => state.buyRequests?.length > 0);
a.emit("requestBuyIn", { code: createReply.code, toSeat: bob.seat, amount: 200 });
const requestStateB = await requestStateForB;

const transferStateForA = waitForState(a, (state) => (
  state.players.find((player) => player.name === "Alice")?.chips === 700 &&
  state.players.find((player) => player.name === "Bob")?.chips === 0
));
const responseReply = await new Promise((resolve) => b.emit("respondBuyIn", {
  code: createReply.code,
  requestId: requestStateB.buyRequests?.[0]?.id,
  accept: true,
}, resolve));
if (!responseReply?.ok) throw new Error(responseReply?.error || "respondBuyIn failed");

const finalA = await transferStateForA;

console.log(JSON.stringify({
  createReply,
  alice: finalA.players.find((player) => player.name === "Alice")?.chips,
  bob: finalA.players.find((player) => player.name === "Bob")?.chips,
  message: finalA.message,
}, null, 2));

a.close();
b.close();
