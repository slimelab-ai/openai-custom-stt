# openai-custom-stt

OpenClaw plugin for **OpenAI-compatible speech-to-text** against a configurable remote host, including both file transcription and realtime streaming transcription.

This follows the lightweight structure used by the `openclaw-voxcpm2-plugin` repo:
- `package.json` with OpenClaw extension metadata
- `openclaw.plugin.json` for plugin manifest + config UI hints
- `index.js` entrypoint
- provider implementation in a single JS module

## What it solves

OpenClaw's built-in `openai` media-understanding provider expects the normal OpenAI auth path. This plugin gives you a separate provider id, `openai-custom-stt`, so audio transcription can target a custom OpenAI-compatible host without colliding with the built-in OpenAI provider wiring.

## Config

Example plugin config:

```json
{
  "baseUrl": "http://your-remote-host:8000/v1",
  "authToken": "your-token",
  "defaultModel": "whisper-1",
  "requestTimeoutMs": 120000
}
```

Supported config keys:
- `baseUrl`: Remote OpenAI-compatible base URL
- `apiKey`: Alias for bearer token
- `authToken`: Preferred bearer token field
- `authHeaderName`: Custom auth header name, defaults to `Authorization`
- `defaultModel`: Default file transcription model
- `streamingModel`: Default realtime transcription model
- `requestTimeoutMs`: HTTP timeout
- `silenceDurationMs`: Realtime VAD silence duration
- `vadThreshold`: Realtime VAD threshold
- `defaultLanguage`: Optional default language for transcriptions
- `defaultPrompt`: Optional default prompt for transcriptions
- `additionalHeaders`: Extra static headers to send

## Expected API

The remote host should expose an OpenAI-compatible transcription route:

- `POST /audio/transcriptions`

with multipart form data containing:
- `file`
- `model`
- optional `language`
- optional `prompt`

And return JSON like:

```json
{ "text": "transcript here" }
```

## Intended OpenClaw usage

Configure media transcription to use provider id `openai-custom-stt` instead of `openai`.

For voice-call streaming transcription, set the voice-call plugin `streaming.provider` to `openai-custom-stt`.

## Development

This repo is intentionally tiny and unbundled, matching the VoxCPM2 pattern.

## Realtime transcription

This plugin also registers a realtime transcription provider using an OpenAI-compatible WebSocket endpoint at:

- `GET /realtime?intent=transcription&model=...`

This is a good fit for [Speaches](https://speaches.ai/), which exposes an OpenAI-compatible realtime transcription API under `/v1/realtime`.

## Recommended use

This plugin is especially useful with [Speaches](https://speaches.ai/) or other OpenAI-compatible speech backends that expose both `/audio/transcriptions` and `/realtime` endpoints.
