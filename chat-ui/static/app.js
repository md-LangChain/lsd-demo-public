const STORAGE = {
  url: "chat-ui.url",
  assistant: "chat-ui.assistant",
  thread: "chat-ui.thread",
  multitask: "chat-ui.multitask",
  response: "chat-ui.response",
};

const MULTITASK_STRATEGIES = {
  enqueue: {
    label: "Enqueue",
    busy: "Agent is responding…",
    multi: (n) => `${n} runs in flight (Enqueue)…`,
  },
  reject: {
    label: "Reject",
    busy: "Agent is responding…",
    multi: (n) => `${n} runs in flight (Reject)…`,
  },
  interrupt: {
    label: "Interrupt",
    busy: "Agent is responding…",
    multi: (n) => `${n} runs in flight (Interrupt)…`,
  },
  rollback: {
    label: "Rollback",
    busy: "Agent is responding…",
    multi: (n) => `${n} runs in flight (Rollback)…`,
  },
};

const els = {
  keyPill: document.getElementById("key-pill"),
  threadPill: document.getElementById("thread-pill"),
  deploymentSelect: document.getElementById("deployment-select"),
  assistantSelect: document.getElementById("assistant-select"),
  refreshDeployments: document.getElementById("btn-refresh-deployments"),
  serverUrl: document.getElementById("server-url"),
  assistantId: document.getElementById("assistant-id"),
  multitask: document.getElementById("multitask-strategy"),
  responseMode: document.getElementById("response-mode"),
  connect: document.getElementById("btn-connect"),
  neu: document.getElementById("btn-new"),
  reconnect: document.getElementById("btn-reconnect"),
  log: document.getElementById("log"),
  composer: document.getElementById("composer"),
  prompt: document.getElementById("prompt"),
  send: document.getElementById("btn-send"),
  status: document.getElementById("status"),
};

const state = {
  threadId: localStorage.getItem(STORAGE.thread) || "",
  inflight: 0,
  connected: false,
  creatingThread: null,
  deployments: [],
  assistants: [],
};

function setStatus(text) {
  els.status.textContent = text || "";
}

function selectedStrategy() {
  const value = (els.multitask && els.multitask.value) || "enqueue";
  return MULTITASK_STRATEGIES[value] ? value : "enqueue";
}

function selectedResponseMode() {
  const value = (els.responseMode && els.responseMode.value) || "wait";
  return value === "stream" ? "stream" : "wait";
}

function strategyMeta(name = selectedStrategy()) {
  return MULTITASK_STRATEGIES[name] || MULTITASK_STRATEGIES.enqueue;
}

function persist() {
  localStorage.setItem(STORAGE.url, els.serverUrl.value.trim());
  localStorage.setItem(STORAGE.assistant, els.assistantId.value.trim());
  localStorage.setItem(STORAGE.multitask, selectedStrategy());
  localStorage.setItem(STORAGE.response, selectedResponseMode());
  if (state.threadId) localStorage.setItem(STORAGE.thread, state.threadId);
  else localStorage.removeItem(STORAGE.thread);
}

function headers(extra = {}) {
  const hdrs = { Accept: "application/json", ...extra };
  const url = els.serverUrl.value.trim().replace(/\/$/, "");
  if (url) hdrs["X-Agent-Server-Url"] = url;
  return hdrs;
}

async function api(method, path, body) {
  const hdrs = headers();
  const init = { method, headers: hdrs };
  if (body !== undefined) {
    hdrs["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || text || res.statusText;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function contentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.content || "";
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  if (typeof content === "object") return content.text || content.content || "";
  return String(content);
}

function messageRole(msg) {
  const type = String((msg && (msg.type || msg.role)) || "").toLowerCase();
  if (type === "human" || type === "user") return "user";
  if (
    type === "ai" ||
    type === "assistant" ||
    type === "aimessage" ||
    type === "aimessagechunk"
  ) {
    return "assistant";
  }
  if (type === "tool" || type === "tool_result") return "tool";
  return "system";
}

function extractMessages(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.messages)) return payload.messages;
  if (payload.values && Array.isArray(payload.values.messages)) return payload.values.messages;
  if (payload.data && Array.isArray(payload.data.messages)) return payload.data.messages;
  if (Array.isArray(payload)) return payload;
  return [];
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messageRole(messages[i]) === "assistant") {
      const text = contentText(messages[i].content);
      if (text) return text;
    }
  }
  return "";
}

function emptyState(title, copy) {
  return `<div class="empty-state"><img class="empty-logo" src="/static/logo.svg" width="48" height="48" alt="" /><p class="empty-title">${title}</p><p class="empty-copy">${copy}</p></div>`;
}

function addBubble(role, text, extraClass) {
  const empty = els.log.querySelector(".empty-state");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `msg ${role}` + (extraClass ? ` ${extraClass}` : "");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role;
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  div.appendChild(who);
  div.appendChild(body);
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
  return div;
}

function setBubbleText(bubble, text) {
  const body = bubble.querySelector(".body");
  body.textContent = text;
  els.log.scrollTop = els.log.scrollHeight;
}

function markSuperseded(bubble, strategy) {
  if (!bubble || bubble.dataset.settled === "1") return;
  bubble.classList.remove("streaming");
  bubble.classList.add("superseded");
  bubble.dataset.settled = "1";
  const label = strategyMeta(strategy).label;
  const verb = strategy === "rollback" ? "rolled back" : "interrupted";
  const existing = (bubble.querySelector(".body")?.textContent || "").trim();
  setBubbleText(
    bubble,
    existing
      ? `${existing}\n\n(${verb} · ${label})`
      : `Run ${verb} (${label}).`
  );
}

function supersedeInflight(strategy) {
  els.log.querySelectorAll(".msg.assistant.streaming").forEach((bubble) => {
    markSuperseded(bubble, strategy);
  });
}

function renderHistory(messages) {
  els.log.innerHTML = "";
  const visible = messages.filter((msg) => {
    const role = messageRole(msg);
    const text = contentText(msg.content);
    return (role === "user" || role === "assistant") && Boolean(text);
  });
  if (!visible.length) {
    els.log.innerHTML = emptyState("Thread is empty", "Send a message to start.");
    return;
  }
  for (const msg of visible) {
    addBubble(messageRole(msg), contentText(msg.content));
  }
}

function setConnected(on) {
  state.connected = on;
  els.prompt.disabled = !on;
  els.send.disabled = !on;
  els.neu.disabled = !on;
  els.serverUrl.disabled = on;
  els.assistantId.disabled = on;
  els.connect.disabled = on;
  els.reconnect.disabled = !on;
  if (els.deploymentSelect) els.deploymentSelect.disabled = on;
  if (els.assistantSelect) els.assistantSelect.disabled = on || !state.assistants.length;
  if (els.refreshDeployments) els.refreshDeployments.disabled = on;
  els.threadPill.textContent = state.threadId
    ? `thread ${state.threadId.slice(0, 8)}…`
    : "no thread";
  els.threadPill.className = "pill " + (state.threadId ? "ok" : "muted");
}

function fillSelect(select, placeholder, items, valueKey, labelFn, selected) {
  if (!select) return;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  select.appendChild(blank);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = String(item[valueKey] || "");
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
  if (selected) select.value = selected;
  if (!select.value) select.value = "";
}

function resetAssistantSelect(placeholder) {
  state.assistants = [];
  fillSelect(els.assistantSelect, placeholder || "Select a deployment first", [], "assistant_id", () => "");
  if (els.assistantSelect) els.assistantSelect.disabled = true;
}

async function refreshDeployments() {
  if (!els.deploymentSelect) return;
  els.deploymentSelect.disabled = true;
  if (els.refreshDeployments) els.refreshDeployments.disabled = true;
  setStatus("Scanning LangSmith deployments…");
  try {
    const data = await fetch("/deployments").then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload.detail || payload.error || res.statusText;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      return payload;
    });
    state.deployments = Array.isArray(data.deployments) ? data.deployments : [];
    const ready = state.deployments.filter((d) => d.ready && d.url);
    const currentUrl = els.serverUrl.value.trim().replace(/\/$/, "");
    fillSelect(
      els.deploymentSelect,
      ready.length ? "Select a deployment" : "No ready deployments found",
      ready,
      "url",
      (d) => d.name || d.url,
      currentUrl
    );
    if (!ready.length) {
      resetAssistantSelect("No ready deployments found");
      setStatus(
        data.workspace_id === "unset"
          ? "No ready deployments. If expected, set LANGSMITH_WORKSPACE_ID in .env."
          : "No ready deployments with a URL were found."
      );
    } else {
      setStatus(`Found ${ready.length} ready deployment${ready.length === 1 ? "" : "s"}.`);
      if (els.deploymentSelect.value) {
        await onDeploymentPicked(els.deploymentSelect.value);
      } else {
        resetAssistantSelect("Select a deployment first");
      }
    }
  } catch (err) {
    state.deployments = [];
    fillSelect(els.deploymentSelect, "Scan failed — try Refresh", [], "url", () => "");
    resetAssistantSelect("Select a deployment first");
    setStatus(String(err.message || err));
  } finally {
    if (!state.connected) {
      els.deploymentSelect.disabled = false;
      if (els.refreshDeployments) els.refreshDeployments.disabled = false;
    }
  }
}

async function onDeploymentPicked(url) {
  const clean = (url || "").trim().replace(/\/$/, "");
  if (!clean) {
    resetAssistantSelect("Select a deployment first");
    return;
  }
  els.serverUrl.value = clean;
  persist();
  if (els.assistantSelect) {
    els.assistantSelect.disabled = true;
    fillSelect(els.assistantSelect, "Loading assistants…", [], "assistant_id", () => "");
  }
  setStatus("Loading assistants…");
  try {
    const data = await fetch(`/deployments/assistants?url=${encodeURIComponent(clean)}`).then(
      async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = payload.detail || payload.error || res.statusText;
          throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
        }
        return payload;
      }
    );
    state.assistants = Array.isArray(data.assistants) ? data.assistants : [];
    const current = els.assistantId.value.trim();
    fillSelect(
      els.assistantSelect,
      state.assistants.length ? "Select an assistant" : "No assistants found",
      state.assistants,
      "assistant_id",
      (a) => {
        if (a.graph_id && a.name && a.name !== a.graph_id) return `${a.name} (${a.graph_id})`;
        return a.name || a.graph_id || a.assistant_id;
      },
      current
    );
    if (els.assistantSelect && !state.connected) els.assistantSelect.disabled = !state.assistants.length;
    if (els.assistantSelect && els.assistantSelect.value) {
      els.assistantId.value = els.assistantSelect.value;
      persist();
    } else if (state.assistants.length === 1) {
      els.assistantSelect.value = state.assistants[0].assistant_id;
      els.assistantId.value = state.assistants[0].assistant_id;
      persist();
    }
    setStatus(
      state.assistants.length
        ? `Loaded ${state.assistants.length} assistant${state.assistants.length === 1 ? "" : "s"}.`
        : "Deployment selected, but no assistants were returned."
    );
  } catch (err) {
    resetAssistantSelect("Failed to load assistants");
    setStatus(String(err.message || err));
  }
}

function onAssistantPicked(assistantId) {
  if (!assistantId) return;
  els.assistantId.value = assistantId;
  persist();
}

function updateBusyStatus() {
  if (state.inflight <= 0) {
    setStatus("");
    return;
  }
  const meta = strategyMeta();
  const mode = selectedResponseMode() === "stream" ? "streaming" : "waiting";
  const base = state.inflight === 1 ? meta.busy : meta.multi(state.inflight);
  setStatus(`${base.replace(/\u2026$/, "")} (${mode})…`);
}

function newConnection() {
  state.threadId = "";
  state.inflight = 0;
  state.creatingThread = null;
  localStorage.removeItem(STORAGE.thread);
  setConnected(false);
  els.log.innerHTML = emptyState(
    "New connection",
    "Pick a deployment from LangSmith, or enter a URL and assistant id."
  );
  setStatus("Disconnected. Choose a deployment or enter connection details.");
  if (els.deploymentSelect) els.deploymentSelect.focus();
  else {
    els.serverUrl.focus();
    els.serverUrl.select();
  }
}

function autoSizePrompt() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 160)}px`;
}

async function createThread() {
  if (state.creatingThread) return state.creatingThread;
  state.creatingThread = (async () => {
    const thread = await api("POST", "/threads", {});
    state.threadId = thread.thread_id || thread.threadId || thread.id;
    persist();
    setConnected(true);
    els.log.innerHTML = emptyState("New thread", "Send a message to start.");
    return state.threadId;
  })();
  try {
    return await state.creatingThread;
  } finally {
    state.creatingThread = null;
  }
}

async function connect() {
  persist();
  if (!els.serverUrl.value.trim() || !els.assistantId.value.trim()) {
    setStatus("Need both Agent Server URL and assistant_id.");
    return;
  }
  setStatus("Connecting…");
  try {
    await api("GET", "/ok");
    const assistant = await api("GET", `/assistants/${els.assistantId.value.trim()}`);
    const name = assistant.name || assistant.graph_id || "assistant";
    if (state.threadId) {
      try {
        const statePayload = await api("GET", `/threads/${state.threadId}/state`);
        renderHistory(extractMessages(statePayload));
        setConnected(true);
        setStatus(`Connected to ${name}. Resumed thread.`);
        return;
      } catch {
        state.threadId = "";
      }
    }
    await createThread();
    setStatus(`Connected to ${name}.`);
  } catch (err) {
    setConnected(false);
    setStatus(String(err.message || err));
    addBubble("system", String(err.message || err), "error");
  }
}

function formatRunError(err, strategy) {
  const raw = String(err.message || err);
  const status = err.status;
  const label = strategyMeta(strategy).label;
  if (strategy === "reject" || status === 409 || /already running|busy|reject/i.test(raw)) {
    return `Rejected: a run is already in progress (${label}).`;
  }
  if (/interrupt/i.test(raw) || status === 409) {
    return `Run ended early (${label}).`;
  }
  return raw;
}

function isAssistantMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  const type = String(msg.type || msg.role || "").toLowerCase();
  if (!type) return Boolean(contentText(msg.content));
  return (
    type === "ai" ||
    type === "assistant" ||
    type === "aimessage" ||
    type === "aimessagechunk"
  );
}

function parseSseBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  if (raw === "" || raw === "[DONE]") return { event, data: null };
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

async function readSse(res, onEvent) {
  if (!res.body) throw new Error("Streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Agent Server / uvicorn emit CRLF SSE frames (\r\n\r\n). Normalize so
    // event boundaries split correctly; otherwise the UI buffers until end.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const parsed = parseSseBlock(part.trim());
      if (parsed) await onEvent(parsed);
    }
  }
  const trailing = buffer.trim();
  if (trailing) {
    const parsed = parseSseBlock(trailing);
    if (parsed) await onEvent(parsed);
  }
}

async function waitAssistantReply(assistantId, text, bubble, strategy) {
  const result = await api("POST", `/threads/${state.threadId}/runs/wait`, {
    assistant_id: assistantId,
    multitask_strategy: strategy,
    input: { messages: [{ role: "human", content: text }] },
  });

  if (bubble.dataset.settled === "1") return;

  let messages = extractMessages(result);
  let reply = lastAssistantText(messages);

  if (!reply) {
    const statePayload = await api("GET", `/threads/${state.threadId}/state`);
    messages = extractMessages(statePayload);
    reply = lastAssistantText(messages);
  }

  if (bubble.dataset.settled === "1") return;

  bubble.classList.remove("streaming");
  bubble.dataset.settled = "1";
  if (reply) {
    setBubbleText(bubble, reply);
    return;
  }
  if (result && result.__interrupt__) {
    bubble.className = "msg system";
    setBubbleText(bubble, "The agent paused for approval (interrupt). Resume it in LangSmith.");
    return;
  }
  setBubbleText(bubble, "(no assistant text)");
}

async function streamAssistantReply(assistantId, text, bubble, strategy) {
  const hdrs = headers({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  const res = await fetch(`/threads/${state.threadId}/runs/stream`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      assistant_id: assistantId,
      multitask_strategy: strategy,
      stream_mode: ["messages-tuple", "messages", "values"],
      stream_subgraphs: true,
      input: { messages: [{ role: "human", content: text }] },
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { detail: raw };
    }
    const detail = (data && (data.detail || data.error)) || raw || res.statusText;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  let assembled = "";
  let valuesReply = "";
  let sawInterrupt = false;

  await readSse(res, async ({ event, data }) => {
    if (bubble.dataset.settled === "1") return;
    if (event === "error") {
      const detail =
        (data && (data.detail || data.error || data.message)) ||
        (typeof data === "string" ? data : JSON.stringify(data));
      throw new Error(detail || "Stream error");
    }
    if (event === "messages" || event === "messages/partial" || event === "messages/complete") {
      const msg = Array.isArray(data) ? data[0] : data;
      if (!isAssistantMessage(msg)) return;
      const piece = contentText(msg.content);
      if (!piece) return;
      if (event === "messages/partial" || event === "messages/complete") {
        assembled = piece;
      } else {
        assembled += piece;
      }
      setBubbleText(bubble, assembled);
      return;
    }
    if (event === "values") {
      valuesReply = lastAssistantText(extractMessages(data)) || valuesReply;
      if (!assembled && valuesReply) setBubbleText(bubble, valuesReply);
      if (data && data.__interrupt__) sawInterrupt = true;
    }
  });

  if (bubble.dataset.settled === "1") return;

  let reply = assembled || valuesReply;
  if (!reply) {
    try {
      const statePayload = await api("GET", `/threads/${state.threadId}/state`);
      reply = lastAssistantText(extractMessages(statePayload));
    } catch {
      // keep empty
    }
  }

  bubble.classList.remove("streaming");
  bubble.dataset.settled = "1";
  if (reply) {
    setBubbleText(bubble, reply);
    return;
  }
  if (sawInterrupt) {
    bubble.className = "msg system";
    setBubbleText(bubble, "The agent paused for approval (interrupt). Resume it in LangSmith.");
    return;
  }
  setBubbleText(bubble, "(no assistant text)");
}

async function loadAssistantReply(assistantId, text, bubble, strategy) {
  if (selectedResponseMode() === "stream") {
    await streamAssistantReply(assistantId, text, bubble, strategy);
  } else {
    await waitAssistantReply(assistantId, text, bubble, strategy);
  }
}

async function sendMessage(text) {
  const assistantId = els.assistantId.value.trim();
  const strategy = selectedStrategy();
  if (!state.threadId) await createThread();

  if ((strategy === "interrupt" || strategy === "rollback") && state.inflight > 0) {
    supersedeInflight(strategy);
  }

  state.inflight += 1;
  addBubble("user", text);
  updateBusyStatus();

  const bubble = addBubble("assistant", "", "streaming");
  try {
    await loadAssistantReply(assistantId, text, bubble, strategy);
  } catch (err) {
    if (bubble.dataset.settled === "1") {
      // Already marked superseded by a newer interrupt/rollback.
    } else if (
      (strategy === "interrupt" || strategy === "rollback") &&
      (/interrupt|cancel|aborted|rolled.?back/i.test(String(err.message || err)) ||
        err.status === 409)
    ) {
      markSuperseded(bubble, strategy);
    } else {
      bubble.classList.remove("streaming");
      bubble.className = "msg system error";
      bubble.dataset.settled = "1";
      setBubbleText(bubble, formatRunError(err, strategy));
      setStatus(formatRunError(err, strategy));
    }
  } finally {
    state.inflight = Math.max(0, state.inflight - 1);
    if (state.inflight === 0) setStatus("");
    else updateBusyStatus();
    els.prompt.focus();
  }
}

async function boot() {
  els.serverUrl.value = localStorage.getItem(STORAGE.url) || "";
  els.assistantId.value = localStorage.getItem(STORAGE.assistant) || "";
  const savedStrategy = localStorage.getItem(STORAGE.multitask) || "enqueue";
  if (els.multitask) {
    els.multitask.value = MULTITASK_STRATEGIES[savedStrategy] ? savedStrategy : "enqueue";
    els.multitask.addEventListener("change", () => {
      persist();
      if (state.inflight > 0) updateBusyStatus();
    });
  }
  const savedResponse = localStorage.getItem(STORAGE.response) || "wait";
  if (els.responseMode) {
    els.responseMode.value = savedResponse === "stream" ? "stream" : "wait";
    els.responseMode.addEventListener("change", () => {
      persist();
      if (state.inflight > 0) updateBusyStatus();
    });
  }
  try {
    const meta = await fetch("/meta").then((r) => r.json());
    els.keyPill.textContent = `API key ${meta.api_key}`;
    els.keyPill.className = `pill ${meta.api_key === "set" ? "ok" : "warn"}`;
    if (!els.serverUrl.value && meta.default_url) els.serverUrl.value = meta.default_url;
  } catch {
    els.keyPill.textContent = "API key unknown";
  }
  setConnected(false);
  els.reconnect.disabled = true;
  els.connect.addEventListener("click", connect);
  els.reconnect.addEventListener("click", newConnection);
  if (els.refreshDeployments) {
    els.refreshDeployments.addEventListener("click", () => {
      refreshDeployments();
    });
  }
  if (els.deploymentSelect) {
    els.deploymentSelect.addEventListener("change", () => {
      onDeploymentPicked(els.deploymentSelect.value);
    });
  }
  if (els.assistantSelect) {
    els.assistantSelect.addEventListener("change", () => {
      onAssistantPicked(els.assistantSelect.value);
    });
  }
  els.neu.addEventListener("click", async () => {
    if (!state.connected) {
      setStatus("Connect first.");
      return;
    }
    try {
      await createThread();
      setStatus("Started a new thread.");
    } catch (err) {
      setStatus(String(err.message || err));
    }
  });
  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.prompt.value.trim();
    if (!text) return;
    els.prompt.value = "";
    autoSizePrompt();
    sendMessage(text);
  });
  els.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });
  els.prompt.addEventListener("input", autoSizePrompt);
  refreshDeployments();
}

boot();
