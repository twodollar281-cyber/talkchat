# TalkChat live streaming

TalkChat live streaming uses browser WebRTC directly between the broadcaster and viewers. TalkChat stores the stream title, lifecycle timestamps, and moderated chat comments in the existing application database; it does not upload or record the live audio/video.

## Setup

- No streaming-provider account, API key, or new environment variable is required.
- The app must be served over HTTPS (or localhost) so Android and other browsers can grant camera/microphone access.
- The browser uses Google's public STUN endpoint for basic NAT discovery. This does not relay media and is not a guaranteed connection path.
- For now, each stream is limited to 10 connected viewers. Networks that block direct peer connections may require a TURN service; none is enabled automatically, so this implementation will not incur a hidden relay-service charge.

The broadcaster grants camera and microphone access when opening the preview. The preview is local and is not live until the broadcaster presses **Canlı başlat**. Viewers need to remain connected to watch. If the broadcaster disconnects or the server restarts, the stream is ended rather than left marked live. The owner can end the stream; moderators with sufficient role hierarchy can end streams and remove comments. Existing call signaling and WebRTC call files are not changed.
