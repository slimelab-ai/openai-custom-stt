import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenAiCustomSttProvider } from "./media-provider.js";

export default definePluginEntry({
  id: "openai-custom-stt",
  name: "OpenAI Custom STT",
  description: "Media-understanding provider for OpenAI-compatible remote speech-to-text",
  register(api) {
    api.registerMediaUnderstandingProvider(
      buildOpenAiCustomSttProvider({
        config: api.pluginConfig || {},
        logger: api.logger,
      }),
    );
  },
});
