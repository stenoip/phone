// api/socket.js
export const config = {
  runtime: 'edge',
};

const clients = new Map(); // etiketteringId -> WebSocket

export default async function handler(req) {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let myId = null;

  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (data.type === 'register' && data.id) {
      myId = data.id;
      clients.set(myId, socket);
      return;
    }

    if (data.to && clients.has(data.to)) {
      clients.get(data.to).send(JSON.stringify({
        type: data.type,
        offer: data.offer,
        answer: data.answer,
        candidate: data.candidate,
        from: myId
      }));
    }
  };

  socket.onclose = () => {
    if (myId) {
      clients.delete(myId);
    }
  };

  return response;
}
