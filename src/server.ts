import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";

type ExtWebSocket = WebSocket & {
  user?: any;
  subscriptions?: Set<string>;
  lastPong?: number;
};

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "keyboard-cat";

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});

const wss = new WebSocketServer({ noServer: true, path: "/ws" });

function extractTokenFromReq(req: http.IncomingMessage): string | null {
  try {
    const reqUrl = req.url || "/";
    const host = req.headers.host || "localhost";
    const parsed = new URL(reqUrl, `http://${host}`);
    const qToken = parsed.searchParams.get("token");
    if (qToken) return qToken;

    const auth = (req.headers["authorization"] ||
      req.headers["Authorization"]) as string | undefined;
    if (auth) {
      const m = auth.match(/Bearer\s+(.+)/i);
      if (m) return m[1];
    }

    const proto = req.headers["sec-websocket-protocol"] as string | undefined;
    if (proto) {
      const candidate = proto
        .split(",")
        .map((s) => s.trim())
        .find(Boolean);
      if (candidate) return candidate;
    }
  } catch (err) {}
  return null;
}

server.on("upgrade", (req, socket, head) => {
  const token = extractTokenFromReq(req);

  if (!token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    // attach decoded JWT payload to socket for later use
    (ws as ExtWebSocket).user = payload;
    (ws as ExtWebSocket).subscriptions = new Set();
    (ws as ExtWebSocket).lastPong = Date.now();

    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (wsRaw: WebSocket, req) => {
  const ws = wsRaw as ExtWebSocket;
  console.log("Client connected:", ws.user?.sub ?? "unknown");

  ws.on("message", (data) => {
    let msg: any;
    try {
      msg =
        typeof data === "string"
          ? JSON.parse(data)
          : JSON.parse(data.toString());
    } catch (err) {
      console.warn("Invalid JSON received, ignoring");
      return;
    }

    switch (msg?.type) {
      case "pong":
        ws.lastPong = Date.now();
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        break;

      case "subscribe":
        if (typeof msg.symbol === "string") {
          ws.subscriptions?.add(msg.symbol);
          ws.send(JSON.stringify({ type: "subscribed", symbol: msg.symbol }));
          console.log("Subscribed client to", msg.symbol);
        }
        break;

      case "unsubscribe":
        if (typeof msg.symbol === "string") {
          ws.subscriptions?.delete(msg.symbol);
          ws.send(JSON.stringify({ type: "unsubscribed", symbol: msg.symbol }));
        }
        break;

      default:
        console.log("Unknown message type", msg?.type);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("Client closed", code, reason?.toString?.());
  });

  ws.on("error", (err) => {
    console.warn("Client error", err);
  });
});

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((client) => {
    const c = client as ExtWebSocket;

    if (now - (c.lastPong || 0) > HEARTBEAT_TIMEOUT_MS) {
      console.log("Terminating stale client");
      try {
        c.terminate();
      } catch (err) {
        return;
      }
    }

    try {
      c.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    } catch (err) {}
  });
}, HEARTBEAT_INTERVAL_MS);

setInterval(() => {
  const tick = {
    price: (20000 + Math.random() * 5000).toFixed(2),
    volume: (Math.random() * 2).toFixed(6),
    ts: new Date().toISOString(),
  };

  for (const client of wss.clients) {
    const c = client as ExtWebSocket;
    if (c.subscriptions?.has("BTCUSDT") && c.readyState === WebSocket.OPEN) {
      try {
        c.send(JSON.stringify({ type: "tick", symbol: "BTCUSDT", tick }));
      } catch (err) {}
    }
  }
}, 3000);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}  (WS path: /ws)`);
  console.log(
    `Create a JWT with secret "${JWT_SECRET}" to connect (short-lived recommended).`
  );
});
