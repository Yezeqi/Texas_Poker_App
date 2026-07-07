import { io } from "socket.io-client";

const onceState = (client) => new Promise((resolve) => client.once("state", resolve));
const waitForEvent = (client, event, predicate = () => true, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    client.off(event, onEvent);
    reject(new Error(`Timed out waiting for ${event}`));
  }, timeoutMs);
  function onEvent(payload) {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    client.off(event, onEvent);
    resolve(payload);
  }
  client.on(event, onEvent);
});

const a = io("http://localhost:3000");
const b = io("http://localhost:3000");

await Promise.all([
  new Promise((resolve) => a.on("connect", resolve)),
  new Promise((resolve) => b.on("connect", resolve)),
]);

const createdState = onceState(a);
const createReply = await new Promise((resolve) => a.emit("createRoom", { name: "Alice", token: "voice-a" }, resolve));
await createdState;

const joinedStates = Promise.all([onceState(a), onceState(b)]);
await new Promise((resolve) => b.emit("joinRoom", { code: createReply.code, name: "Bob", token: "voice-b" }, resolve));
await joinedStates;

const joinedVoice = waitForEvent(b, "voicePeerJoined", (payload) => payload.id === a.id);
a.emit("voiceJoin", { code: createReply.code });
await joinedVoice;

const signalPayload = { type: "ice", candidate: { candidate: "test", sdpMid: "0", sdpMLineIndex: 0 } };
const relayedSignal = waitForEvent(a, "voiceSignal", (payload) => payload.from === b.id && payload.signal?.type === "ice");
b.emit("voiceSignal", { code: createReply.code, to: a.id, signal: signalPayload });
await relayedSignal;

console.log(JSON.stringify({
  createReply,
  voiceJoinRelayed: true,
  voiceSignalRelayed: true,
}, null, 2));

a.close();
b.close();
