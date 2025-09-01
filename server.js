

var http = require('http');
var WebSocket = require('ws');

var PORT = process.env.PORT || 3000;
var server = http.createServer();
var wss = new WebSocket.Server({ server: server });

var clients = {}; // { etiketteringId: WebSocket }

function sendTo(targetId, message) {
  var conn = clients[targetId];
  if (conn && conn.readyState === WebSocket.OPEN) {
    conn.send(JSON.stringify(message));
  }
}

wss.on('connection', function (ws) {
  var myId = null;

  ws.on('message', function (msg) {
    var data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    if (data.type === 'register' && data.id) {
      myId = data.id;
      clients[myId] = ws;
      console.log('Registered:', myId);
      return;
    }

    if (data.to) {
      sendTo(data.to, {
        type: data.type,
        offer: data.offer,
        answer: data.answer,
        candidate: data.candidate,
        from: myId
      });
    }
  });

  ws.on('close', function () {
    if (myId && clients[myId]) {
      delete clients[myId];
      console.log('Disconnected:', myId);
    }
  });
});

server.listen(PORT, function () {
  console.log('Signaling server running on port', PORT);
});
