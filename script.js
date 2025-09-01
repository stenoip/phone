// script.js
const WS_URL = "wss://phone-one-iota.vercel.app/api/socket";

// Prompt user for their ID
const id = prompt("Your ID (e.g., alice):")?.trim();

// Create WebSocket connection
const ws = new WebSocket(WS_URL);

// When connection opens, register this client
ws.onopen = () => {
  if (id) {
    ws.send(JSON.stringify({ type: "register", id }));
    console.log(`Registered as: ${id}`);
  } else {
    console.warn("No ID entered — registration skipped.");
  }
};

// Handle incoming messages
ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    console.log("IN:", msg);

    // TODO: Handle 'offer', 'answer', 'candidate' messages here
    // Example:
    // if (msg.type === "offer") { ... }
  } catch (err) {
    console.error("Error parsing message:", err);
  }
};

// Helper functions to send signaling messages
function sendOffer(to, offer) {
  ws.send(JSON.stringify({ type: "offer", to, offer }));
}

function sendAnswer(to, answer) {
  ws.send(JSON.stringify({ type: "answer", to, answer }));
}

function sendCandidate(to, candidate) {
  ws.send(JSON.stringify({ type: "candidate", to, candidate }));
}

// Optional: keepalive ping every 25 seconds
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}, 25000);
