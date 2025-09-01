

export default function handler(req, res) {
  if (res.socket.server.ws) {
    res.end();
    return;
  }

  const { Server } = require("ws");
  const wss = new Server({ server: res.socket.server });

  // Map of ID -> WebSocket
  const clients = {};

  wss.on("connection", (ws) => {
    ws.id = null;

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (e) {
        return;
      }

      // Register this connection with an ID
      if (msg.type === "register" && msg.id) {
        ws.id = msg.id;
        clients[ws.id] = ws;
        ws.send(JSON.stringify({ type: "registered", id: ws.id }));
        return;
      }

      // Keepalive ping
      if (msg.type === "ping") {
        return;
      }

      // Forward any message with a "to" field
      if (msg.to && clients[msg.to]) {
        try {
          clients[msg.to].send(JSON.stringify({ ...msg, from: ws.id }));
        } catch (e) {
          // If send fails, drop the client
          delete clients[msg.to];
        }
      } else if (msg.to) {
        // Optional: notify sender that target not found
        ws.send(JSON.stringify({ type: "error", reason: "not-registered", to: msg.to }));
      }
    });

    ws.on("close", () => {
      if (ws.id && clients[ws.id]) {
        delete clients[ws.id];
      }
    });
  });

  res.socket.server.ws = wss;
  res.end();
}
