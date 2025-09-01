

var WS_URL = "wss://phone-one-iota.vercel.app/api/socket";
var ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// UI elements
var statusEl = null;
var calleeInput = null;
var callVideoBtn = null;
var callAudioBtn = null;
var hangupBtn = null;
var incomingBox = null;
var incomingText = null;
var acceptBtn = null;
var declineBtn = null;
var remoteVideo = null;
var localVideo = null;

// State
var etikettering = null;          // my ID
var ws = null;                    // WebSocket
var pc = null;                    // RTCPeerConnection
var localStream = null;
var remoteStream = null;
var inCall = false;
var peerId = null;                // current peer
var requestedMedia = "video";     // "video" or "audio" for incoming call
var awaitingOffer = false;        // callee side: waiting for caller's offer
var queuedCandidates = [];        // candidates received before remoteDescription set

// Initialize after DOM loads
window.addEventListener("DOMContentLoaded", function () {
  statusEl = document.getElementById("status");
  calleeInput = document.getElementById("callee");
  callVideoBtn = document.getElementById("callVideoBtn");
  callAudioBtn = document.getElementById("callAudioBtn");
  hangupBtn = document.getElementById("hangupBtn");
  incomingBox = document.getElementById("incoming");
  incomingText = document.getElementById("incomingText");
  acceptBtn = document.getElementById("acceptBtn");
  declineBtn = document.getElementById("declineBtn");
  remoteVideo = document.getElementById("remoteVideo");
  localVideo = document.getElementById("localVideo");

  // Etikettering (persistent ID like a phone number)
  etikettering = localStorage.getItem("stenocell_id");
  if (!etikettering) {
    etikettering = "SC-" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("stenocell_id", etikettering);
  }
  var myIdEl = document.getElementById("myId");
  if (myIdEl) myIdEl.textContent = "Your Etikettering (ID): " + etikettering;

  connectWS();

  callVideoBtn.onclick = function () { tryStartOutgoingCall("video"); };
  callAudioBtn.onclick = function () { tryStartOutgoingCall("audio"); };
  hangupBtn.onclick = function () { sendByeAndEnd("You ended the call"); };

  acceptBtn.onclick = function () { acceptIncomingCall(); };
  declineBtn.onclick = function () { declineIncomingCall(); };
});

// Connect to signaling server and register our ID
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = function () {
    setStatus("Connected to signaling server");
    ws.send(JSON.stringify({ type: "register", id: etikettering }));
  };

  ws.onmessage = function (e) {
    var msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handleSignal(msg);
  };

  ws.onclose = function () {
    setStatus("Disconnected from signaling server");
  };

  ws.onerror = function () {
    setStatus("WebSocket error");
  };

  // Keepalive
  setInterval(function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 25000);
}

// Handle signaling messages
function handleSignal(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "registered") {
    setStatus("Registered as " + msg.id);
    return;
  }

  if (msg.type === "error" && msg.reason === "not-registered") {
    setStatus("Error: not registered");
    return;
  }

  if (msg.type === "call") {
    // Incoming call notification
    if (inCall) {
      // Already in call -> auto busy
      sendSignal({ type: "busy", to: msg.from });
      return;
    }
    peerId = msg.from;
    requestedMedia = msg.media === "audio" ? "audio" : "video";
    awaitingOffer = true;
    showIncoming("Incoming " + requestedMedia + " call from " + peerId);
    return;
  }

  if (msg.type === "accept") {
    // Callee accepted; caller proceeds to create and send offer
    if (!peerId) peerId = msg.from;
    createConnectionAndOffer(peerId, requestedMedia);
    return;
  }

  if (msg.type === "decline") {
    setStatus("Call declined by " + (msg.from || "peer"));
    resetAfterCall();
    return;
  }

  if (msg.type === "busy") {
    setStatus("Peer is busy");
    resetAfterCall();
    return;
  }

  if (msg.type === "offer" && msg.offer) {
    // Callee receives offer
    handleIncomingOffer(msg.offer, msg.from);
    return;
  }

  if (msg.type === "answer" && msg.answer) {
    // Caller receives answer
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
      setStatus("In call with " + (msg.from || "peer"));
    }
    return;
  }

  if (msg.type === "candidate" && msg.candidate) {
    handleIncomingCandidate(msg.candidate);
    return;
  }

  if (msg.type === "bye") {
    endCall("Peer ended the call");
    return;
  }
}

// UI helpers
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function showIncoming(text) {
  if (incomingText) incomingText.textContent = text;
  if (incomingBox) incomingBox.style.display = "block";
}

function hideIncoming() {
  if (incomingBox) incomingBox.style.display = "none";
}

// Outgoing: user presses Call (video or audio)
function tryStartOutgoingCall(kind) {
  if (inCall) {
    setStatus("Already in a call");
    return;
  }
  var target = (calleeInput.value || "").trim();
  if (!target) {
    alert("Enter an Etikettering (ID) first");
    return;
  }
  peerId = target;
  requestedMedia = kind === "audio" ? "audio" : "video";
  setStatus("Calling " + peerId + " (" + requestedMedia + ")...");
  // Notify peer to show incoming UI
  sendSignal({ type: "call", to: peerId, media: requestedMedia });
  // Wait for "accept" from peer; then we'll create and send an offer
  hangupBtn.disabled = false;
}

// Callee: Accept incoming call
function acceptIncomingCall() {
  if (!peerId) return;
  hideIncoming();
  inCall = true;
  sendSignal({ type: "accept", to: peerId });
  setStatus("Accepted call from " + peerId + ", waiting for offer...");
  hangupBtn.disabled = false;
}

// Callee: Decline
function declineIncomingCall() {
  if (!peerId) return;
  sendSignal({ type: "decline", to: peerId });
  hideIncoming();
  setStatus("Declined call");
  resetAfterCall();
}

// Caller: create RTCPeerConnection, capture media, send offer
async function createConnectionAndOffer(targetId, kind) {
  try {
    await getLocalMedia(kind);
    createPeerConnection(targetId);
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: "offer", to: targetId, offer: offer });
    setStatus("Sent offer to " + targetId);
  } catch (e) {
    setStatus("Failed to start call");
  }
}

// Callee: handle incoming offer, capture media, send answer
async function handleIncomingOffer(offer, fromId) {
  try {
    if (!inCall) {
      // Safety: if user accepted quickly, inCall was set; otherwise ensure it now
      inCall = true;
    }
    if (!peerId) peerId = fromId;

    await getLocalMedia(requestedMedia);
    createPeerConnection(fromId);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    // Add any queued ICE candidates after remote description is set
    flushQueuedCandidates();

    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: "answer", to: fromId, answer: answer });
    setStatus("Answered call from " + fromId);
  } catch (e) {
    setStatus("Failed to handle offer");
  }
}

// Create RTCPeerConnection and wire up events
function createPeerConnection(targetId) {
  pc = new RTCPeerConnection(ICE_CONFIG);

  // Local tracks
  if (localStream) {
    localStream.getTracks().forEach(function (t) {
      pc.addTrack(t, localStream);
    });
  }

  // Remote tracks
  pc.ontrack = function (event) {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
    }
    event.streams[0].getTracks().forEach(function (t) {
      remoteStream.addTrack(t);
    });
  };

  // ICE candidates
  pc.onicecandidate = function (event) {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      sendSignal({ type: "candidate", to: targetId, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = function () {
    var s = pc.connectionState;
    if (s === "connected") setStatus("Connected with " + targetId);
    if (s === "failed" || s === "disconnected") endCall("Connection lost");
  };
}

// Capture local media (audio or video)
async function getLocalMedia(kind) {
  var constraints = kind === "audio" ? { audio: true, video: false } : { audio: true, video: true };
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  localVideo.srcObject = localStream;
}

// Handle incoming ICE candidates
function handleIncomingCandidate(candidate) {
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    pc.addIceCandidate(new RTCIceCandidate(candidate));
  } else {
    queuedCandidates.push(candidate);
  }
}

function flushQueuedCandidates() {
  if (!pc) return;
  while (queuedCandidates.length) {
    var c = queuedCandidates.shift();
    try { pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
  }
}

// Send a signaling message
function sendSignal(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Hang up helpers
function sendByeAndEnd(reason) {
  if (peerId) sendSignal({ type: "bye", to: peerId });
  endCall(reason || "Call ended");
}

function endCall(message) {
  setStatus(message || "Call ended");
  if (pc) { try { pc.close(); } catch (e) {} }
  pc = null;

  if (localStream) {
    try { localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    localStream = null;
  }

  if (remoteVideo && remoteVideo.srcObject) {
    try {
      remoteVideo.srcObject.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
    remoteVideo.srcObject = null;
  }
  remoteStream = null;

  resetAfterCall();
}

function resetAfterCall() {
  inCall = false;
  awaitingOffer = false;
  queuedCandidates = [];
  hangupBtn.disabled = true;
  // Keep peerId, so user can redial; clear if you prefer:
  // peerId = null;
}
