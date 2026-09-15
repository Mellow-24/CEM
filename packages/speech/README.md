# speech/ — speech capability family

English | [中文](README.zh.md)

This family provides scope-aware complete-recording transcription and streaming synthesis capabilities, optional HTTP and WebSocket providers, and a loopback-only Web Consumer.

| Package | Role | ctx key |
|---|---|---|
| [`speech-transcription/`](speech-transcription/README.md) | Service Definition for final transcription and profile permission | `ctx.speechTranscription` |
| [`speech-synthesis/`](speech-synthesis/README.md) | Service Definition for bounded streaming synthesis and profile permission | `ctx.speechSynthesis` |
| [`speech-http/`](speech-http/README.md) | Optional credential-aware HTTP Service Providers | registers on the two speech services |
| [`speech-dashscope/`](speech-dashscope/README.md) | DashScope HTTP SSE synthesis Service Provider | registers on `ctx.speechSynthesis` |
| [`speech-ministream/`](speech-ministream/README.md) | MiniStream WebSocket synthesis Service Provider | registers on `ctx.speechSynthesis` |
| [`speech-web/`](speech-web/README.md) | Host Consumer providing trusted profile, transcription, and synthesis routes | registers on `ctx.connection.fetch` |

Speech remains outside the LLM message and stream vocabularies: Consumers submit accepted transcript text through the ordinary Agent inbox, while synthesis reads committed assistant messages.
