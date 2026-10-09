const $ = (id) => document.getElementById(id);
const icons = { discord: "D", telegram: "↗", whatsapp: "W" };
const descriptions = {
  discord: "Servers, channels, and conversations. All within reach of your dot.",
  telegram: "Your conversations and contacts, connected through your own account.",
  whatsapp: "Your chats, connected with a linked device on this computer.",
};
let token = "";
let selected = "overview";
try {
  const fragment = new URLSearchParams(location.hash.slice(1));
  token = fragment.get("token") || sessionStorage.getItem("setup-token") || "";
  if (token) sessionStorage.setItem("setup-token", token);
  selected = sessionStorage.getItem("setup-app") || "overview";
} catch {
  /* The current tab can still use a fragment token without storage. */
  token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
}
if (location.hash) history.replaceState(null, "", location.pathname);
if (!["overview", "discord", "telegram", "whatsapp"].includes(selected)) selected = "overview";
let state;
let loading = false;
let initialized = false;
let submitting = false;
let screen = "account";
let watchedJob;
let ignoredJob;
let toastTimer;
let cardsMarkup = "";
let connectionNotice = false;
let qrKey = "";
let qrExpires = 0;
let passwordKey = "";
const currentJob = () => state?.jobs?.[selected];
const questions = {
  discord: "Show me my Discord servers and their channels.",
  telegram: "Show me my recent Telegram conversations.",
  whatsapp: "Show me my recent WhatsApp chats.",
};
function clearSecrets() {
  for (const id of ["bot-token", "tunnel-key", "api-hash", "two-step-password"]) $(id).value = "";
}
function clearLoginUi() {
  qrKey = "";
  qrExpires = 0;
  passwordKey = "";
  $("login-qr").removeAttribute("src");
  $("qr-panel").hidden = true;
  $("password-form").hidden = true;
  $("two-step-password").value = "";
  $("cancel-login").hidden = true;
}

function announce(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3500);
}
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not complete this request.");
  return result;
}
const appById = (id) => state?.apps.find((app) => app.id === id);
function status(app) {
  if (app.issue) return { text: "Needs attention", style: "warning" };
  if (!app.configured) return { text: "Not connected", style: "" };
  if (app.ready && app.processRunning && app.healthy)
    return { text: "Tunnel ready", style: "ready" };
  if (app.processRunning)
    return { text: app.healthy ? "Getting ready" : "Check connection", style: "warning" };
  if (app.id !== "discord" && !app.sessionSaved)
    return { text: "Sign-in needed", style: "warning" };
  return { text: "Stopped", style: "" };
}
function renderCards() {
  const apps = state?.apps.filter((app) => app.kind === "built-in") || [
    { id: "discord", name: "Discord", tools: 99 },
    { id: "telegram", name: "Telegram", tools: 139 },
    { id: "whatsapp", name: "WhatsApp", tools: 17 },
  ];
  const markup = apps
    .map((app) => {
      const badge = status(app);
      const action = app.configured ? "Manage connection" : `Connect ${app.name}`;
      return `<article class="app-card"><div class="card-top"><div class="app-icon ${app.id}" aria-hidden="true">${icons[app.id]}</div><span class="badge ${badge.style}">${badge.text}</span></div><h3>${app.name}</h3><p>${descriptions[app.id]}</p><div class="card-meta"><span>${app.tools} tools</span><i></i><span>${app.id === "discord" ? "Bot account" : "Personal account"}</span></div><button class="card-button" data-select="${app.id}">${action}<span aria-hidden="true">↗</span></button></article>`;
    })
    .join("");
  // Preserve keyboard focus when polling returns unchanged cards.
  if (markup !== cardsMarkup) {
    $("app-cards").innerHTML = markup;
    cardsMarkup = markup;
  }
  $("next-step").disabled = !initialized;
  const ready = apps.filter((app) => app.ready && app.processRunning && app.healthy).length;
  $("connection-count").textContent = initialized
    ? `${ready} of 3 tunnels ready`
    : "Checking connections…";
  for (const app of apps)
    $("nav-" + app.id).classList.toggle(
      "ready",
      Boolean(app.ready && app.processRunning && app.healthy),
    );
}
function setScreen(next, focus = false) {
  screen = next;
  if (next !== "progress") clearLoginUi();
  for (const id of ["account", "tunnel", "progress", "manage"])
    $(id + "-screen").hidden = id !== next;
  const order = ["account", "tunnel", "progress", "manage"];
  document.querySelectorAll("[data-step]").forEach((element) => {
    element.classList.toggle("active", element.dataset.step === next);
    element.classList.toggle("done", order.indexOf(element.dataset.step) < order.indexOf(next));
    if (element.dataset.step === next) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  });
  if (focus) {
    const heading =
      next === "account"
        ? $(selected + "-account").querySelector("h2")
        : $(next + "-screen").querySelector("h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
}
function populateSettings() {
  const app = appById(selected);
  clearSecrets();
  $("tunnel-id").value = app?.tunnelId || "";
  $("guilds").value = app?.guilds || "all";
  $("api-id").value = app?.apiId || "";
  $("bridge-port").value = app?.bridgePort || "8766";
  $("hash-saved").hidden = !app?.credentialsSaved;
  for (const id of ["bot-saved", "key-saved"]) $(id).hidden = !app?.credentialsSaved;
  $("bot-help").textContent = app?.credentialsSaved
    ? "Leave blank to keep your saved bot token, or paste a new one."
    : "Stored privately on this computer. It won’t be shown again.";
  $("key-help").textContent = app?.credentialsSaved
    ? "Leave blank to keep your saved runtime key, or paste a new one."
    : "Your key is saved locally and never returned to this page.";
}
function selectApp(id) {
  if (!["overview", "discord", "telegram", "whatsapp"].includes(id)) return;
  clearSecrets();
  clearLoginUi();
  selected = id;
  try {
    sessionStorage.setItem("setup-app", id);
  } catch {
    /* Optional. */
  }
  document
    .querySelectorAll(".nav-item")
    .forEach((element) => element.classList.toggle("active", element.dataset.select === id));
  $("overview").hidden = id !== "overview";
  $("detail").hidden = id === "overview";
  if (id === "overview") return;
  const app = appById(id) || {
    id,
    name: id === "whatsapp" ? "WhatsApp" : id[0].toUpperCase() + id.slice(1),
  };
  $("detail-title").textContent = app.name;
  $("detail-icon").className = `app-icon ${id}`;
  $("detail-icon").textContent = icons[id];
  $("detail-description").textContent = descriptions[id];
  for (const name of ["discord", "telegram", "whatsapp"]) $(name + "-account").hidden = name !== id;
  $("account-meta").textContent =
    `${app.tools || ""} tools · ${id === "discord" ? "Bot account" : "Personal account"}`;
  $("tunnel-app-title").textContent = `Create a tunnel for ${app.name}`;
  $("setup-summary").textContent =
    id === "discord"
      ? "We’ll verify the bot, save your settings, and start the tunnel."
      : "We’ll prepare this app, show a QR code to approve on your phone, and start the tunnel after sign-in.";
  $("connect-button").firstChild.textContent =
    id === "discord" ? "Save & connect " : "Continue to sign-in ";
  $("finish-intro").textContent = `Your tunnel is ready. Now add ${app.name} to ChatGPT.`;
  $("tunnel-label").textContent = `YOUR ${app.name.toUpperCase()} TUNNEL`;
  $("first-question").textContent = `“${questions[id]}”`;
  $("copy-question").dataset.copy = questions[id];
  $("qr-title").textContent = `Open ${app.name} on your phone`;
  $("qr-instructions").textContent =
    id === "telegram"
      ? "Go to Settings → Devices → Link Desktop Device. Scan this code and approve the login."
      : "Go to Settings (or the Android menu) → Linked devices → Link a device. Scan this code and approve linking.";
  populateSettings();
  const job = currentJob();
  if (
    job?.status === "running" ||
    (["failed", "cancelled"].includes(job?.status) && job.id !== ignoredJob)
  ) {
    watchedJob = job.id;
    setScreen("progress");
  } else setScreen(app.configured ? "manage" : "account");
  renderDetail();
}
async function renderLogin(job) {
  const app = selected;
  const running = job?.status === "running";
  $("cancel-login").hidden = !running || !["login", "qr", "password"].includes(job.stage);
  $("cancel-login").disabled = false;
  if (running && job.qr && job.qr.expiresAt > Date.now()) {
    const key = `${app}:${job.id}:${job.qr.version}`;
    if (qrKey !== key) {
      qrKey = key;
      qrExpires = job.qr.expiresAt;
      $("login-qr").removeAttribute("src");
      $("qr-panel").hidden = true;
      try {
        const result = await api(
          `/api/${app}/qr?jobId=${encodeURIComponent(job.id)}&version=${job.qr.version}`,
        );
        if (qrKey === key && qrExpires > Date.now() && selected === app && screen === "progress") {
          $("login-qr").src = result.image;
          $("qr-panel").hidden = false;
        }
      } catch {
        if (qrKey === key) {
          qrKey = "";
          $("qr-panel").hidden = true;
        }
      }
    }
  } else {
    qrKey = "";
    qrExpires = 0;
    $("qr-panel").hidden = true;
    $("login-qr").removeAttribute("src");
  }
  if (selected !== app || screen !== "progress" || currentJob() !== job) return;
  const challenge = running && job.stage === "password" ? job.passwordRequestId : "";
  if (passwordKey !== challenge) {
    passwordKey = challenge;
    $("two-step-password").value = "";
  }
  $("password-form").hidden = !challenge;
}
function renderDetail() {
  if (selected === "overview") return;
  const app = appById(selected);
  if (!app) return;
  const badge = status(app);
  $("detail-status").textContent = badge.text;
  $("detail-status").className = `badge ${badge.style}`;
  $("app-issue").textContent = app.issue || "";
  $("app-issue").hidden = !app.issue;
  const job = currentJob();
  const busy = job?.status === "running" || submitting;
  const ready = app.ready && app.processRunning && app.healthy;
  $("runtime-dot").classList.toggle("ready", Boolean(ready));
  $("runtime-title").textContent = ready
    ? "Your private tunnel is ready"
    : app.processRunning
      ? "Waiting for the tunnel"
      : "Your tunnel is stopped";
  $("runtime-description").textContent = ready
    ? "MCP is available through this tunnel. You can close this page."
    : app.processRunning
      ? "Status updates automatically. If this takes too long, stop the tunnel and check your settings."
      : "Start it to connect from your AI app. Your settings are saved.";
  $("start-button").hidden =
    Boolean(app.processRunning) || (selected !== "discord" && !app.sessionSaved);
  $("login-button").hidden = selected === "discord" || Boolean(app.processRunning);
  $("login-button").textContent = app.sessionSaved ? "Sign in again" : "Sign in with QR";
  $("stop-button").hidden = !app.processRunning;
  $("edit-settings").disabled = Boolean(app.processRunning || busy);
  $("edit-settings").title = app.processRunning
    ? "Stop the tunnel before editing settings."
    : "Edit your saved settings";
  $("finish-guide").hidden = !ready;
  $("saved-tunnel").textContent = app.tunnelId || "";
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = Boolean(busy);
  });

  if (job && job.id !== ignoredJob && job.status === "running") {
    watchedJob = job.id;
    setScreen("progress");
  }
  if (screen === "progress" && job && job.id === watchedJob) {
    if (job.status === "succeeded") {
      setScreen("manage", true);
      announce(job.message);
    } else {
      $("progress-title").textContent =
        job.status === "cancelled"
          ? "Login cancelled."
          : job.status === "failed"
            ? "Let’s try that again."
            : job.action === "stop"
              ? "Stopping your tunnel."
              : "Connecting the dots.";
      $("progress-message").textContent = job.message;
      $("progress-symbol").textContent = job.status === "failed" ? "!" : "↻";
      $("progress-symbol").classList.toggle("spinning", job.status === "running");
      $("recovery-actions").hidden = job.status === "running";
      $("retry-login").hidden =
        selected === "discord" || !app.configured || Boolean(app.processRunning);
      $("back-to-settings").hidden = Boolean(app.processRunning);
      $("retry-start").hidden =
        !app.configured || job.action === "stop" || (selected !== "discord" && !app.sessionSaved);
      $("retry-stop").hidden = !app.processRunning;
      $("copy-doctor").dataset.copy = app.commands.at(-1);
      void renderLogin(job);
    }
  }
}
async function refresh() {
  if (loading) return;
  if (!token) {
    notice("Open the setup link printed by apps-of-dots ui in your terminal to unlock this page.");
    return;
  }
  loading = true;
  $("refresh").disabled = true;
  try {
    state = await api("/api/state");
    const first = !initialized;
    initialized = true;
    if (connectionNotice) notice("");
    connectionNotice = false;
    renderCards();
    $("prerequisite").hidden = state.tunnelClientInstalled;
    if (first) selectApp(selected);
    else renderDetail();
  } catch (error) {
    connectionNotice = true;
    notice(
      error.name === "TypeError" || error.name === "TimeoutError"
        ? "The setup center isn’t responding. Check the terminal running apps-of-dots ui, then refresh this page."
        : error.message,
    );
  } finally {
    loading = false;
    $("refresh").disabled = false;
  }
}
async function mutate(action, input = {}) {
  if (!state || submitting || currentJob()?.status === "running") return;
  const app = selected;
  notice("");
  submitting = true;
  $("connect-button").disabled = true;
  renderDetail();
  try {
    const job = await api(`/api/${app}/${action}`, input);
    state.jobs[app] = job;
    if (selected !== app) return;
    watchedJob = job.id;
    ignoredJob = undefined;
    setScreen("progress", true);
    renderDetail();
  } catch (error) {
    if (selected === app) {
      notice(error.message || "Could not connect. Please try again.");
      if (action === "setup") setScreen("account", true);
    }
  } finally {
    submitting = false;
    $("connect-button").disabled = false;
    renderDetail();
  }
}
function validAccount() {
  if (selected === "whatsapp") return true;
  if (selected === "telegram") {
    const id = $("api-id");
    id.setCustomValidity(
      /^[1-9][0-9]*$/.test(id.value.trim()) ? "" : "Enter your Telegram API ID.",
    );
    if (!id.reportValidity()) return false;
    const hash = $("api-hash");
    hash.setCustomValidity(
      /^[a-fA-F0-9]{32}$/.test(hash.value.trim()) ||
        (!hash.value && appById(selected)?.credentialsSaved)
        ? ""
        : "Enter the 32-character API hash.",
    );
    return hash.reportValidity();
  }
  const field = $("bot-token");
  field.setCustomValidity(
    !field.value.trim() && !appById(selected)?.credentialsSaved
      ? "Enter your Discord bot token."
      : "",
  );
  return field.reportValidity();
}
$("next-step").addEventListener("click", () => {
  if (validAccount()) setScreen("tunnel", true);
});
$("previous-step").addEventListener("click", () => setScreen("account", true));
$("bot-token").addEventListener("input", () => $("bot-token").setCustomValidity(""));
$("tunnel-id").addEventListener("input", () => $("tunnel-id").setCustomValidity(""));
$("tunnel-key").addEventListener("input", () => $("tunnel-key").setCustomValidity(""));
$("setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (screen === "account") {
    if (validAccount()) setScreen("tunnel", true);
    return;
  }
  const tunnel = $("tunnel-id");
  tunnel.setCustomValidity(
    /^tunnel_[a-zA-Z0-9_-]+$/.test(tunnel.value.trim())
      ? ""
      : "Enter your tunnel ID, starting with tunnel_.",
  );
  if (!tunnel.reportValidity()) return;
  const key = $("tunnel-key");
  key.setCustomValidity(
    !key.value.trim() && !appById(selected)?.credentialsSaved
      ? "Enter your tunnel runtime API key."
      : "",
  );
  if (!key.reportValidity()) return;
  const input = {
    tunnelId: tunnel.value.trim(),
    tunnelKey: key.value.trim(),
    ...(selected === "discord"
      ? { botToken: $("bot-token").value.trim(), guilds: $("guilds").value.trim() || "all" }
      : selected === "telegram"
        ? { apiId: $("api-id").value.trim(), apiHash: $("api-hash").value.trim() }
        : { bridgePort: $("bridge-port").value.trim() || "8766" }),
  };
  clearSecrets();
  void mutate("setup", input);
});
$("edit-settings").addEventListener("click", () => {
  ignoredJob = currentJob()?.id;
  populateSettings();
  setScreen("account", true);
});
$("back-to-settings").addEventListener("click", () => {
  ignoredJob = currentJob()?.id;
  populateSettings();
  setScreen("account", true);
});
$("copy-tunnel").addEventListener("click", () => copy(appById(selected)?.tunnelId || ""));
$("refresh").addEventListener("click", () => void refresh());
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    announce("Copied to clipboard.");
  } catch {
    announce("Select the text and copy it with your keyboard.");
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  if (target.dataset.select) selectApp(target.dataset.select);
  if (target.dataset.copy) void copy(target.dataset.copy);
  if (target.dataset.action) void mutate(target.dataset.action);
});
renderCards();
void refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, 2500);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
// A newly printed link can open in this same tab after the UI server restarts.
// Fragment-only navigation does not reload the document, so refresh authorization.
window.addEventListener("hashchange", () => {
  const nextToken = new URLSearchParams(location.hash.slice(1)).get("token");
  if (!nextToken) return;
  token = nextToken;
  try {
    sessionStorage.setItem("setup-token", token);
  } catch {
    /* Storage is optional for the current page. */
  }
  history.replaceState(null, "", location.pathname);
  connectionNotice = true;
  void refresh();
});

for (const id of ["api-id", "api-hash"])
  $(id).addEventListener("input", () => $(id).setCustomValidity(""));
$("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const job = currentJob();
  const password = $("two-step-password").value;
  if (!password || !job?.passwordRequestId) return;
  $("two-step-password").value = "";
  $("submit-password").disabled = true;
  try {
    await api(`/api/${selected}/password`, {
      jobId: job.id,
      requestId: job.passwordRequestId,
      password,
    });
    await refresh();
  } catch (error) {
    notice(error.message);
  } finally {
    $("submit-password").disabled = false;
  }
});
$("cancel-login").addEventListener("click", async () => {
  const job = currentJob();
  if (!job) return;
  $("cancel-login").disabled = true;
  clearLoginUi();
  try {
    await api(`/api/${selected}/cancel`, { jobId: job.id });
    await refresh();
  } catch (error) {
    notice(error.message);
  }
});
setInterval(() => {
  if (!qrExpires) return;
  const seconds = Math.max(0, Math.ceil((qrExpires - Date.now()) / 1000));
  $("qr-expiry").textContent = seconds
    ? `Refreshes in about ${seconds}s`
    : "Waiting for a fresh QR code…";
  if (!seconds) {
    qrKey = "";
    qrExpires = 0;
    $("login-qr").removeAttribute("src");
    $("qr-panel").hidden = true;
  }
}, 1000);
