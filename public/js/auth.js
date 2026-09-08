const labels = JSON.parse(document.getElementById("auth-labels")?.textContent || "{}");

function setMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ok", Boolean(ok) && Boolean(text));
  el.classList.toggle("is-bad", !ok && Boolean(text));
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/availability`);
  const timers = {};

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type !== "availability") return;
    const text = msg.available ? labels.available : (labels.errors && labels.errors[msg.reason]) || msg.reason;
    setMsg(`${msg.field}-msg`, text, msg.available);
    const input = document.getElementById(msg.field);
    if (input) input.classList.toggle("is-invalid", !msg.available);
  });

  function watch(field) {
    const input = document.getElementById(field);
    if (!input) return;
    const send = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "check", field, value: input.value }));
    };
    input.addEventListener("input", () => {
      clearTimeout(timers[field]);
      timers[field] = setTimeout(send, 300);
    });
  }

  ws.addEventListener("open", () => {
    watch("email");
    watch("username");
  });
}

const nameInput = document.getElementById("fullName");
if (nameInput) {
  nameInput.addEventListener("input", () => {
    const value = nameInput.value.trim();
    if (!value) return setMsg("fullName-msg", labels.errors?.name_required, false);
    const ok = /^[\p{L}][\p{L}\s'.-]{1,79}$/u.test(value);
    setMsg("fullName-msg", ok ? labels.available : labels.errors?.name_invalid, ok);
  });
}

if (document.getElementById("register-form")) connect();
