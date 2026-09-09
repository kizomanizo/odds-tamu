const labels = JSON.parse(document.getElementById("auth-labels")?.textContent || "{}");

function setMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ok", Boolean(ok) && Boolean(text));
  el.classList.toggle("is-bad", !ok && Boolean(text));
}

function applyResult(msg) {
  if (!msg || msg.type !== "availability") return;
  const text = msg.available ? labels.available : (labels.errors && labels.errors[msg.reason]) || msg.reason;
  setMsg(`${msg.field}-msg`, text, msg.available);
  const input = document.getElementById(msg.field);
  if (input) input.classList.toggle("is-invalid", !msg.available);
}

async function checkHttp(field, value) {
  const url = `/api/availability?field=${encodeURIComponent(field)}&value=${encodeURIComponent(value)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => null);
  applyResult(data);
}

function connect() {
  const timers = {};
  let socket = null;

  function send(field, value) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "check", field, value }));
      return;
    }
    checkHttp(field, value).catch(() => {});
  }

  function watch(field) {
    const input = document.getElementById(field);
    if (!input) return;
    input.addEventListener("input", () => {
      clearTimeout(timers[field]);
      timers[field] = setTimeout(() => send(field, input.value), 300);
    });
  }

  watch("email");
  watch("username");

  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws/availability`);
    socket.addEventListener("message", (event) => {
      try {
        applyResult(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    });
    socket.addEventListener("error", () => {
      socket = null;
    });
    socket.addEventListener("close", () => {
      socket = null;
    });
  } catch {
    socket = null;
  }
}

const nameInput = document.getElementById("fullName");
if (nameInput) {
  nameInput.addEventListener("input", () => {
    const value = nameInput.value.trim();
    if (!value) return setMsg("fullName-msg", labels.errors?.name_required, false);
    const ok = /^[\p{L}][\p{L}\s'.-]{1,79}$/u.test(value);
    setMsg("fullName-msg", ok ? "" : labels.errors?.name_invalid, ok);
  });
}

if (document.getElementById("register-form")) connect();
