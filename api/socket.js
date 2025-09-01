var WebSocket = require('ws');

var clients = {};

module.exports = function handler(req, res) {
  if (res.socket.server.wss) {
    res.end();
    return;
  }

  var wss = new WebSocket.Server({ server: res.socket.server });
  res.socket.server.wss = wss;

  wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
      var data = {};
      try { data = JSON.parse(message); } catch (e) {}

      if (data.type === 'register') {
        clients[data.id] = ws;
        return;
      }

      if (data.to && clients[data.to]) {
        clients[data.to].send(JSON.stringify({
          type: data.type,
          offer: data.offer,
          answer: data.answer,
          candidate: data.candidate,
          from: data.from || null
        }));
      }
    });

    ws.on('close', function() {
      for (var id in clients) {
        if (clients[id] === ws) {
          delete clients[id];
        }
      }
    });
  });

  res.end();
};
