import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenAiCustomSttProvider } from "./media-provider.js";
import { buildOpenAiCustomRealtimeTranscriptionProvider } from "./realtime-provider.js";

export default definePluginEntry({
  id: "openai-custom-stt",
  name: "OpenAI Custom STT",
  description: "Media-understanding and realtime transcription provider for OpenAI-compatible remote speech-to-text",
  register(api) {
    api.registerMediaUnderstandingProvider(
      buildOpenAiCustomSttProvider({
        config: api.pluginConfig || {},
        logger: api.logger,
      }),
    );

    api.registerRealtimeTranscriptionProvider(
      buildOpenAiCustomRealtimeTranscriptionProvider({
        config: api.pluginConfig || {},
        logger: api.logger,
      }),
    );
  },
});
