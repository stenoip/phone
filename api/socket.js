// api/socket.js
export const config = { runtime: 'edge' };

import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req) {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  let myId = null;
  let sub = null;

  async function subscribeToSelf(id) {
    if (sub?.close) {
      try { await sub.close(); } catch {}
    }
    sub = await redis.subscribe(`ws:${id}`, (msg) => {
      try {
        socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      } catch {}
    });
  }

  async function deliver(to, payload) {
    await redis.publish(`ws:${to}`, JSON.stringify(payload));
  }

  socket.onmessage = async (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'register' && data.id) {
      myId = data.id;
      await subscribeToSelf(myId);
      await redis.set(`online:${myId}`, '1', { ex: 60 });
      socket.send(JSON.stringify({ type: 'registered', id: myId }));
      return;
    }

    if (!myId) {
      socket.send(JSON.stringify({ type: 'error', reason: 'not-registered' }));
      return;
    }

    if (data.type === 'ping') {
      await redis.set(`online:${myId}`, '1', { ex: 60 });
      return;
    }

    if (data.to) {
      await deliver(data.to, { ...data, from: myId });
    }
  };

  socket.onclose = async () => {
    if (myId) {
      await redis.del(`online:${myId}`);
    }
    if (sub?.close) {
      try { await sub.close(); } catch {}
    }
  };

  socket.onerror = (err) => {
    console.error('WebSocket error', err);
  };

  return response;
}
