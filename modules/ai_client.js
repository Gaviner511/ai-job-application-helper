export const DEFAULT_AI_SETTINGS = {
  aiProvider: "local",
  openaiApiKey: "",
  openaiQuality: "balanced",
  openaiModelBalanced: "gpt-5.4-mini",
  openaiModelBetter: "gpt-5.4",
  openaiModelBest: "gpt-5.5",
  confirmCloudAi: true
};

export async function getAiSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_AI_SETTINGS));
  return { ...DEFAULT_AI_SETTINGS, ...stored };
}

export function selectedOpenAiModel(settings = {}) {
  const merged = { ...DEFAULT_AI_SETTINGS, ...settings };
  if (merged.openaiQuality === "best") return merged.openaiModelBest;
  if (merged.openaiQuality === "better") return merged.openaiModelBetter;
  return merged.openaiModelBalanced;
}

function parseJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI returned an empty response.");
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI did not return valid JSON.");
  }
}

function responseText(response) {
  if (response.output_text) return response.output_text;
  const pieces = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" || content.type === "text") pieces.push(content.text || "");
    }
  }
  return pieces.join("\n").trim();
}

export async function openAiJsonRequest({ apiKey, model, system, user, schema }) {
  if (!apiKey) throw new Error("OpenAI API key is missing. Add it in Settings first.");
  const body = {
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: {
      format: {
        type: "json_schema",
        name: schema.name || "structured_result",
        strict: true,
        schema: schema.schema || schema
      }
    }
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI returned ${response.status}.`);
  }
  return parseJsonText(responseText(payload));
}

function normalizeImageDataUrls({ imageDataUrl, imageDataUrls } = {}) {
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl];
  return images.map((item) => String(item || "")).filter(Boolean);
}

export async function openAiVisionJsonRequest({ apiKey, model, system, user, imageDataUrl, imageDataUrls, schema }) {
  if (!apiKey) throw new Error("OpenAI API key is missing. Add it in Settings first.");
  const images = normalizeImageDataUrls({ imageDataUrl, imageDataUrls });
  if (!images.length) throw new Error("Screenshot is missing.");
  const body = {
    model,
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "input_text", text: user },
          ...images.map((image) => ({ type: "input_image", image_url: image }))
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: schema.name || "structured_result",
        strict: true,
        schema: schema.schema || schema
      }
    }
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI returned ${response.status}.`);
  }
  return parseJsonText(responseText(payload));
}

export async function ollamaJsonRequest({ model, system, user, schema }) {
  if (!model) throw new Error("No local Ollama model selected. Open Profile Manager and choose a model.");
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema.schema || schema,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      options: { temperature: 0, num_ctx: 8192 }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403) throw new Error("Ollama blocked this extension. Restart Ollama after setting OLLAMA_ORIGINS=chrome-extension://*.");
  if (!response.ok) throw new Error(payload.error || `Ollama returned ${response.status}.`);
  return parseJsonText(payload.message?.content || "");
}

export async function ollamaVisionJsonRequest({ model, system, user, imageDataUrl, imageDataUrls, schema }) {
  if (!model) throw new Error("No local Ollama model selected. Choose a vision-capable model first.");
  const images = normalizeImageDataUrls({ imageDataUrl, imageDataUrls });
  if (!images.length) throw new Error("Screenshot is missing.");
  const base64Images = images.map((image) => String(image).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""));
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema.schema || schema,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user, images: base64Images }
      ],
      options: { temperature: 0, num_ctx: 8192 }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403) throw new Error("Ollama blocked this extension. Restart Ollama after setting OLLAMA_ORIGINS=chrome-extension://*.");
  if (!response.ok) throw new Error(payload.error || `Ollama returned ${response.status}.`);
  return parseJsonText(payload.message?.content || "");
}

export async function runJsonAi({ system, user, schema, preferProvider = "" }) {
  const settings = await getAiSettings();
  const provider = preferProvider || settings.aiProvider || "local";
  if (provider === "cloud") {
    return openAiJsonRequest({
      apiKey: settings.openaiApiKey,
      model: selectedOpenAiModel(settings),
      system,
      user,
      schema
    });
  }
  const { ollamaModel } = await chrome.storage.local.get("ollamaModel");
  return ollamaJsonRequest({ model: ollamaModel, system, user, schema });
}

export async function runVisionJsonAi({ system, user, imageDataUrl, imageDataUrls, schema, preferProvider = "" }) {
  const settings = await getAiSettings();
  const provider = preferProvider || settings.aiProvider || "local";
  if (provider === "cloud") {
    return openAiVisionJsonRequest({
      apiKey: settings.openaiApiKey,
      model: selectedOpenAiModel(settings),
      system,
      user,
      imageDataUrl,
      imageDataUrls,
      schema
    });
  }
  const { ollamaModel } = await chrome.storage.local.get("ollamaModel");
  return ollamaVisionJsonRequest({ model: ollamaModel, system, user, imageDataUrl, imageDataUrls, schema });
}
