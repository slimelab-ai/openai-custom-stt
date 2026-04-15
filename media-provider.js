const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_TIMEOUT_MS = 120000;

function resolveConfig(raw) {
  return raw || {};
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/u, "");
}

function resolveBaseUrl(cfg, request, ctx) {
  const base = (request.baseUrl || cfg.baseUrl || DEFAULT_BASE_URL).toString().trim();
  const clean = trimTrailingSlashes(base);
  ctx.logger?.debug?.(`openai-custom-stt: using baseUrl=${clean}`);
  return clean;
}

function resolveModel(cfg, request) {
  const model = request.model || cfg.defaultModel || DEFAULT_MODEL;
  return model.toString().trim() || DEFAULT_MODEL;
}

function buildHeaders(cfg, request) {
  const headers = {
    ...(cfg.additionalHeaders || {}),
    ...(request.headers || {}),
  };

  const token = cfg.authToken || cfg.apiKey || request.apiKey;
  const headerName = (cfg.authHeaderName || "Authorization").toString().trim() || "Authorization";

  if (token) {
    headers[headerName] = headerName.toLowerCase() === "authorization"
      ? `Bearer ${token}`
      : token;
  }

  return headers;
}

function buildForm(request, cfg, model) {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(request.buffer)], {
    type: request.mime || "application/octet-stream",
  });

  form.append("file", blob, request.fileName || "audio.bin");
  form.append("model", model);

  const language = request.language || cfg.defaultLanguage;
  const prompt = request.prompt || cfg.defaultPrompt;

  if (language?.trim()) form.append("language", language.trim());
  if (prompt?.trim()) form.append("prompt", prompt.trim());

  return form;
}

async function readErrorText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export function buildOpenAiCustomSttProvider(ctx) {
  const cfg = resolveConfig(ctx.config);

  return {
    id: "openai-custom-stt",
    capabilities: ["audio"],
    defaultModels: { audio: cfg.defaultModel || DEFAULT_MODEL },
    autoPriority: { audio: 5 },
    async transcribeAudio(request) {
      const baseUrl = resolveBaseUrl(cfg, request, ctx);
      const model = resolveModel(cfg, request);
      const timeoutMs = request.timeoutMs ?? cfg.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: buildHeaders(cfg, request),
          body: buildForm(request, cfg, model),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error(`openai-custom-stt request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const text = await readErrorText(response);
        throw new Error(`openai-custom-stt request failed (${response.status}): ${text || response.statusText}`);
      }

      const payload = await response.json();
      const text = payload?.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("openai-custom-stt response missing text");
      }

      return {
        text,
        model,
      };
    },
  };
}
