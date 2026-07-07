import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const waitForState = (client, predicate, timeoutMs = 6000) => new Promise((resolve, reject) => {
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

await new Promise((resolve) => a.on("connect", resolve));

const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Solo", token: "bot-refill-a" }, resolve));
await createdState;

const botJoined = onceState(a);
a.emit("addBot", { code: createReply.code });
await botJoined;

const handStarted = waitForState(a, (state) => state.phase === "preflop");
a.emit("toggleReady", { code: createReply.code });
const preflop = await handStarted;

const bot = preflop.players.find((player) => player.isBot);
if (!bot) throw new Error("Bot did not join");

console.log(JSON.stringify({
  createReply,
  botChips: bot.chips,
  botReady: bot.ready,
  phase: preflop.phase,
}, null, 2));

a.close();
