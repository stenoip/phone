function createSignaling(myId) {
  const serverBase = "https://phone-one-iota.vercel.app/api";
  let eventSource;
  const listeners = {};

  function connect() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`${serverBase}/events?id=${encodeURIComponent(myId)}`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type && listeners[data.type]) {
          listeners[data.type].forEach(cb => cb(data));
        }
      } catch (err) {
        console.error("Bad SSE data", err);
      }
    };
    eventSource.onerror = () => setTimeout(connect, 2000);
  }

  async function send(to, payload) {
    await fetch(`${serverBase}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, payload })
    });
  }

  function on(type, cb) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(cb);
  }

  connect();
  return { send, on };
}
