// src/node-client.ts
import WebSocket from "ws";

const TOKEN = process.env.TEST_JWT || "<paste-your-jwt-here>"; // create a JWT for testing
const URL = `ws://localhost:3000/ws?token=${encodeURIComponent(TOKEN)}`;

let ws: WebSocket | null = null;
let shouldReconnect = true;
let delay = 1000; // initial backoff
const MAX_DELAY = 30_000;

function connect() {
  console.log("Connecting to", URL);
  ws = new WebSocket(URL);

  ws.on("open", () => {
    console.log("Connected");
    delay = 1000; // reset backoff
    // subscribe to BTCUSDT
    ws!.send(JSON.stringify({ type: "subscribe", symbol: "BTCUSDT" }));
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "ping") {
      // reply with pong
      ws!.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "tick" && msg.symbol === "BTCUSDT") {
      console.log("Tick:", msg.tick);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("Closed", code, reason?.toString?.());
    if (!shouldReconnect) return;
    const jitter = Math.random() * 300;
    const wait = Math.min(delay, MAX_DELAY) + jitter;
    console.log(`Reconnecting in ${Math.round(wait)}ms`);
    setTimeout(() => {
      delay = Math.min(delay * 2, MAX_DELAY);
      connect();
    }, wait);
  });

  ws.on("error", (err) => {
    console.error("WS error", err);
    try {
      ws?.close();
    } catch {}
  });
}

connect();

// stop reconnects on ctrl+c
process.on("SIGINT", () => {
  shouldReconnect = false;
  try {
    ws?.close();
  } catch {}
  process.exit();
});
