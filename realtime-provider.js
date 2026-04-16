import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_SILENCE_DURATION_MS = 800;
const DEFAULT_VAD_THRESHOLD = 0.5;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1000;
const CONNECT_TIMEOUT_MS = 10000;

function resolveConfig(raw) {
  return raw || {};
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/u, "");
}

function trimToUndefined(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveBaseUrl(cfg, request, ctx) {
  const base = (request.baseUrl || cfg.baseUrl || DEFAULT_BASE_URL).toString().trim();
  const clean = trimTrailingSlashes(base);
  ctx.logger?.debug?.(`openai-custom-stt realtime: using baseUrl=${clean}`);
  return clean;
}

function resolveRealtimeUrl(baseUrl) {
  const url = new URL(`${baseUrl}/realtime`);
  url.searchParams.set("intent", "transcription");
  return url;
}

function resolveRealtimeModel(cfg, request) {
  return trimToUndefined(request.model)
    || trimToUndefined(request.streamingModel)
    || trimToUndefined(cfg.streamingModel)
    || trimToUndefined(cfg.defaultModel)
    || DEFAULT_MODEL;
}

function resolveAuthHeader(cfg, request) {
  const token = cfg.authToken || cfg.apiKey || request.apiKey;
  const headerName = (cfg.authHeaderName || "Authorization").toString().trim() || "Authorization";
  if (!token) return null;
  return {
    headerName,
    value: headerName.toLowerCase() === "authorization" ? `Bearer ${token}` : token,
  };
}

function buildRealtimeHeaders(cfg, request) {
  const headers = {
    ...(cfg.additionalHeaders || {}),
    ...(request.headers || {}),
  };
  const auth = resolveAuthHeader(cfg, request);
  if (auth) headers[auth.headerName] = auth.value;
  return headers;
}

function normalizeProviderConfig(cfg, request = {}) {
  return {
    baseUrl: resolveBaseUrl(cfg, request, { logger: null }),
    model: resolveRealtimeModel(cfg, request),
    silenceDurationMs: asFiniteNumber(request.silenceDurationMs)
      ?? asFiniteNumber(cfg.silenceDurationMs)
      ?? DEFAULT_SILENCE_DURATION_MS,
    vadThreshold: asFiniteNumber(request.vadThreshold)
      ?? asFiniteNumber(cfg.vadThreshold)
      ?? DEFAULT_VAD_THRESHOLD,
  };
}

class OpenAiCustomRealtimeTranscriptionSession {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.connected = false;
    this.closed = false;
    this.reconnectAttempts = 0;
    this.pendingTranscript = "";
    this.flowId = randomUUID();
  }

  async connect() {
    this.closed = false;
    this.reconnectAttempts = 0;
    await this.doConnect();
  }

  sendAudio(audio) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: audio.toString("base64"),
    });
  }

  close() {
    this.closed = true;
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, "Transcription session closed");
      this.ws = null;
    }
  }

  isConnected() {
    return this.connected;
  }

  async doConnect() {
    const url = this.config.url.toString();
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, { headers: this.config.headers });

      const connectTimeout = setTimeout(() => {
        reject(new Error("openai-custom-stt realtime connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.sendEvent({
          type: "session.update",
          session: {
            input_audio_format: "g711_ulaw",
            input_audio_transcription: { model: this.config.model },
            turn_detection: {
              type: "server_vad",
              threshold: this.config.vadThreshold,
              prefix_padding_ms: 300,
              silence_duration_ms: this.config.silenceDurationMs,
            },
          },
        });
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          this.handleEvent(JSON.parse(data.toString()));
        } catch (error) {
          this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      });

      this.ws.on("error", (error) => {
        if (!this.connected) {
          clearTimeout(connectTimeout);
          reject(error);
          return;
        }
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      this.ws.on("close", () => {
        this.connected = false;
        if (this.closed) return;
        this.attemptReconnect();
      });
    });
  }

  async attemptReconnect() {
    if (this.closed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.config.onError?.(new Error("openai-custom-stt realtime reconnect limit reached"));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.closed) return;
    try {
      await this.doConnect();
    } catch (error) {
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      await this.attemptReconnect();
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) {
          this.pendingTranscript += event.delta;
          this.config.onPartial?.(this.pendingTranscript);
        }
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) this.config.onTranscript?.(event.transcript);
        this.pendingTranscript = "";
        return;
      case "input_audio_buffer.speech_started":
        this.pendingTranscript = "";
        this.config.onSpeechStart?.();
        return;
      case "error": {
        const detail = event?.error?.message || event?.error?.type || "Unknown realtime transcription error";
        this.config.onError?.(new Error(detail));
        return;
      }
      default:
        return;
    }
  }

  sendEvent(event) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
}

export function buildOpenAiCustomRealtimeTranscriptionProvider(ctx) {
  const cfg = resolveConfig(ctx.config);

  return {
    id: "openai-custom-stt",
    label: "OpenAI Custom Realtime Transcription",
    resolveConfig: ({ rawConfig }) => ({
      ...resolveConfig(rawConfig),
    }),
    isConfigured: ({ providerConfig }) => Boolean(resolveAuthHeader(resolveConfig(providerConfig), {})),
    createSession: (req) => {
      const sessionCfg = resolveConfig(req.providerConfig);
      const auth = resolveAuthHeader(sessionCfg, req);
      if (!auth) throw new Error("openai-custom-stt realtime auth missing");

      const normalized = normalizeProviderConfig(sessionCfg, req);
      const url = resolveRealtimeUrl(normalized.baseUrl);
      url.searchParams.set("model", normalized.model);

      return new OpenAiCustomRealtimeTranscriptionSession({
        ...req,
        url,
        headers: buildRealtimeHeaders(sessionCfg, req),
        model: normalized.model,
        silenceDurationMs: normalized.silenceDurationMs,
        vadThreshold: normalized.vadThreshold,
      });
    },
  };
}
