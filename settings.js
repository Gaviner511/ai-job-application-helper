const $ = (selector) => document.querySelector(selector);
function on(selector, eventName, handler, options) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (!element) {
    console.warn(`Settings: missing element for ${eventName}: ${selector}`);
    return null;
  }
  element.addEventListener(eventName, handler, options);
  return element;
}

const list = $("#memory-list");
const status = $("#status");
const DEFAULT_AI_SETTINGS = {
  aiProvider: "local",
  openaiApiKey: "",
  openaiQuality: "balanced",
  openaiModelBalanced: "gpt-5.4-mini",
  openaiModelBetter: "gpt-5.4",
  openaiModelBest: "gpt-5.5",
  confirmCloudAi: true
};
const DEFAULT_UI_SETTINGS = {
  jahUxMode: "basic"
};

function setStatus(message) {
  if (status) status.textContent = message;
}

function prettyKey(key) {
  return String(key || "")
    .replace(/:/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function loadAiSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_AI_SETTINGS));
  const settings = { ...DEFAULT_AI_SETTINGS, ...stored };
  $("#ai-provider").value = settings.aiProvider;
  $("#openai-quality").value = settings.openaiQuality;
  $("#openai-api-key").value = settings.openaiApiKey;
  $("#openai-model-balanced").value = settings.openaiModelBalanced;
  $("#openai-model-better").value = settings.openaiModelBetter;
  $("#openai-model-best").value = settings.openaiModelBest;
  $("#confirm-cloud-ai").checked = Boolean(settings.confirmCloudAi);
}

async function loadUiSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_UI_SETTINGS));
  const mode = stored.jahUxMode === "advanced" ? "advanced" : "basic";
  const input = document.querySelector(`input[name="ux-mode"][value="${mode}"]`);
  if (input) input.checked = true;
}

function selectedModel(settings) {
  if (settings.openaiQuality === "best") return settings.openaiModelBest;
  if (settings.openaiQuality === "better") return settings.openaiModelBetter;
  return settings.openaiModelBalanced;
}

function aiSettingsFromForm() {
  return {
    aiProvider: $("#ai-provider").value,
    openaiQuality: $("#openai-quality").value,
    openaiApiKey: $("#openai-api-key").value.trim(),
    openaiModelBalanced: $("#openai-model-balanced").value.trim() || DEFAULT_AI_SETTINGS.openaiModelBalanced,
    openaiModelBetter: $("#openai-model-better").value.trim() || DEFAULT_AI_SETTINGS.openaiModelBetter,
    openaiModelBest: $("#openai-model-best").value.trim() || DEFAULT_AI_SETTINGS.openaiModelBest,
    confirmCloudAi: $("#confirm-cloud-ai").checked
  };
}

async function loadMemory() {
  return (await chrome.storage.local.get("mappingMemory")).mappingMemory || {};
}

async function saveMemory(memory) {
  await chrome.storage.local.set({ mappingMemory: memory });
}

async function renderMemory() {
  const memory = await loadMemory();
  const entries = Object.values(memory).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (!list) return;
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved corrections yet. Save one from the scan review panel after changing a field mapping.";
    list.append(empty);
    setStatus("No saved corrections.");
    return;
  }
  for (const entry of entries) {
    const card = document.createElement("div");
    card.className = "memory-card";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.label || entry.signature || "Saved field";
    const key = document.createElement("span");
    key.textContent = `Maps to: ${prettyKey(entry.key)}`;
    const meta = document.createElement("small");
    meta.textContent = `${entry.host || "unknown site"} | saved ${entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "unknown time"}`;
    text.append(title, key, meta);
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      const current = await loadMemory();
      delete current[entry.id];
      await saveMemory(current);
      setStatus("Deleted saved correction.");
      await renderMemory();
    });
    card.append(text, remove);
    list.append(card);
  }
  setStatus(`Loaded ${entries.length} saved correction(s).`);
}

on("#refresh", "click", renderMemory);
on("#save-ai-settings", "click", async () => {
  await chrome.storage.local.set(aiSettingsFromForm());
  setStatus("Saved AI settings.");
});
on("#test-cloud-ai", "click", async () => {
  const settings = aiSettingsFromForm();
  if (!settings.openaiApiKey) {
    setStatus("Add an OpenAI API key first.");
    return;
  }
  try {
    setStatus("Testing cloud AI...");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model: selectedModel(settings),
        input: "Reply with OK as JSON.",
        text: {
          format: {
            type: "json_schema",
            name: "cloud_test",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { ok: { type: "string" } },
              required: ["ok"]
            }
          }
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI returned ${response.status}.`);
    await chrome.storage.local.set(settings);
    setStatus(`Cloud AI works with ${selectedModel(settings)}. Settings saved.`);
  } catch (error) {
    setStatus(`Cloud AI test failed: ${error.message}`);
  }
});
on("#clear-all", "click", async () => {
  if (!confirm("Delete all saved field corrections?")) return;
  await saveMemory({});
  setStatus("Deleted all saved corrections.");
  await renderMemory();
});
document.querySelectorAll('input[name="ux-mode"]').forEach((input) => {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ jahUxMode: input.value === "advanced" ? "advanced" : "basic" });
    setStatus(`Saved ${input.value === "advanced" ? "Advanced" : "Basic"} mode.`);
  });
});
on("#repair-helper-state", "click", async () => {
  const all = await chrome.storage.local.get(null);
  const temporaryKeys = Object.keys(all).filter((key) => key.startsWith("scanState:") || key === "resumeTailorTempState");
  if (temporaryKeys.length) await chrome.storage.local.remove(temporaryKeys);
  setStatus(temporaryKeys.length ? `Cleared ${temporaryKeys.length} temporary helper item(s). Reload the page if the floating helper is still stuck.` : "No temporary helper state was found.");
});

loadAiSettings();
loadUiSettings();
renderMemory();
