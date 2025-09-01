// api/socket.js
export const config = { runtime: 'edge' };

import { Redis } from '@upstash/redis';

// Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env
const redis = Redis.fromEnv();

// Small helper to stringify once
function pack(payload) {
  return JSON.stringify(payload);
}

export default async function handler(req) {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  let clientId = null;
  let subscription = null;
  let closed = false;

  // Forward a signaling message to a recipient's channel
  async function deliver(to, message) {
    try {
      await redis.publish(`ws:${to}`, pack(message));
    } catch (err) {
      console.error('Publish error:', err);
    }
  }

  // Subscribe this socket to its own channel
  async function subscribeSelf(id) {
    try {
      // Close previous subscription if any (re-register)
      if (subscription?.close) {
        try { await subscription.close(); } catch (_) {}
      }

      // Each connection listens only to its own channel
      subscription = await redis.subscribe(`ws:${id}`, (msg) => {
        // msg is the raw payload published by peers
        try {
          // If it's JSON already, just forward it as string; browsers expect string
          socket.send(typeof msg === 'string' ? msg : pack(msg));
        } catch (err) {
          console.error('Socket send error:', err);
        }
      });
    } catch (err) {
      console.error('Subscribe error:', err);
    }
  }

  socket.onopen = () => {
    // Optional: let the client know the socket is ready
    try { socket.send(pack({ type: 'ws-open' })); } catch (_) {}
  };

  socket.onmessage = async (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch {
      // Ignore non-JSON
      return;
    }

    // Health check from clients
    if (data.type === 'ping') {
      try { socket.send(pack({ type: 'pong' })); } catch (_) {}
      return;
    }

    // Registration: { type: "register", id: "alice" }
    if (data.type === 'register' && typeof data.id === 'string' && data.id.trim()) {
      clientId = data.id.trim();

      // Subscribe to own channel so we can receive messages from any instance
      await subscribeSelf(clientId);

      // Optionally mark "online" with short TTL (useful for presence if you want it)
      try { await redis.set(`online:${clientId}`, '1', { ex: 60 }); } catch (_) {}

      try { socket.send(pack({ type: 'registered', id: clientId })); } catch (_) {}
      return;
    }

    // Require registration before routing anything
    if (!clientId) {
      try { socket.send(pack({ type: 'error', reason: 'not-registered' })); } catch (_) {}
      return;
    }

    // Route signaling messages by publishing to the recipient’s channel
    // Expect payloads like:
    // - { type: "offer", to, offer }
    // - { type: "answer", to, answer }
    // - { type: "candidate", to, candidate }
    if (data.to && typeof data.to === 'string') {
      const outbound = {
        type: data.type,
        offer: data.offer,
        answer: data.answer,
        candidate: data.candidate,
        from: clientId,
        ts: Date.now(),
      };
      await deliver(data.to, outbound);
      return;
    }

    // Fallback
    try { socket.send(pack({ type: 'error', reason: 'bad-message' })); } catch (_) {}
  };

  socket.onclose = async () => {
    if (closed) return;
    closed = true;

    // Best-effort cleanup
    if (subscription?.close) {
      try { await subscription.close(); } catch (_) {}
    }
    if (clientId) {
      try { await redis.del(`online:${clientId}`); } catch (_) {}
    }
  };

  socket.onerror = (e) => {
    console.error('WebSocket error:', e?.message || e);
  };

  return response;
}
