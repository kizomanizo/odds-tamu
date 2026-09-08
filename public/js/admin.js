const boot = JSON.parse(document.getElementById("admin-boot")?.textContent || "{}");
const labels = boot.labels || {};

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error("request_failed");
    err.data = data;
    throw err;
  }
  return data;
}

function setStatus(id, text, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ok", ok && Boolean(text));
  el.classList.toggle("is-bad", !ok && Boolean(text));
}

const createForm = document.getElementById("admin-create-user");
if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(createForm);
    try {
      const result = await postJson("/admin/api/users", Object.fromEntries(form.entries()));
      setStatus("create-user-status", result.status === "PENDING" ? labels.created_pending : labels.created, true);
      createForm.reset();
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      const first = err.data?.errors ? Object.values(err.data.errors).find(Boolean) : null;
      setStatus("create-user-status", first || labels.failed, false);
    }
  });
}

document.querySelectorAll(".js-approve").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await postJson(`/admin/api/users/${btn.dataset.id}/approve`);
      location.reload();
    } catch {
      setStatus("create-user-status", labels.failed, false);
    }
  });
});

document.querySelectorAll(".js-reject").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await postJson(`/admin/api/users/${btn.dataset.id}/reject`);
      location.reload();
    } catch {
      setStatus("create-user-status", labels.failed, false);
    }
  });
});

const settingsForm = document.getElementById("admin-settings");
if (settingsForm) {
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(settingsForm);
    try {
      await postJson("/admin/api/settings", Object.fromEntries(form.entries()));
      setStatus("settings-status", labels.saved, true);
    } catch {
      setStatus("settings-status", labels.failed, false);
    }
  });
}

const fetchBtn = document.getElementById("admin-fetch");
if (fetchBtn) {
  fetchBtn.addEventListener("click", async () => {
    fetchBtn.disabled = true;
    try {
      await postJson("/admin/api/fetch");
      setStatus("fetch-status", labels.fetched, true);
      setTimeout(() => location.reload(), 800);
    } catch {
      setStatus("fetch-status", labels.failed, false);
    } finally {
      fetchBtn.disabled = false;
    }
  });
}

document.querySelectorAll(".js-issue-reset").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      const result = await postJson(`/admin/api/resets/${btn.dataset.id}/issue`);
      setStatus(
        "reset-status",
        `${labels.reset_issued} · ${result.email} · code ${result.code} · password ${result.tempPassword}`,
        true,
      );
    } catch {
      setStatus("reset-status", labels.failed, false);
    }
  });
});
