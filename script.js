const etikettering = localStorage.getItem("stenocell_id") || 
  (() => {
    const id = "SC-" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("stenocell_id", id);
    return id;
  })();

document.getElementById("myId").textContent = "Your Etikettering: " + etikettering;
const statusEl = document.getElementById("status");

const signaling = createSignaling(etikettering);

signaling.on("call", (msg) => {
  document.getElementById("incomingText").textContent = `Incoming call from ${msg.from}`;
  document.getElementById("incoming").style.display = "block";
});

document.getElementById("callBtn").onclick = () => {
  const to = document.getElementById("callee").value.trim();
  if (!to) return;
  signaling.send(to, { type: "call", from: etikettering });
  statusEl.textContent = "Calling " + to;
};
