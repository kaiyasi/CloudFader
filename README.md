# CloudFader

Multi-device synchronized music playback for live events.

CloudFader runs on one Windows computer and lets phones, tablets, or other computers control and join playback from a browser. No mobile app is required.

Developed by [Serelix Studio](https://github.com/kaiyasi).

## Download

Download the latest `CloudFader.exe` from [GitHub Releases](https://github.com/kaiyasi/CloudFader/releases/latest).

The release contains one portable executable. Put your music in an `audio` folder next to the exe, then run it.

## Quick Start

1. Download `CloudFader.exe`.
2. Create an `audio` folder next to `CloudFader.exe`.
3. Put `.mp3`, `.m4a`, `.wav`, or `.ogg` files in that folder.
4. Double-click `CloudFader.exe`.
5. Open the displayed Cloudflare URL on controller devices.
6. Open `/player.html` on playback devices and press **Enable Player**.

On first launch, CloudFader downloads `cloudflared.exe` automatically. Internet access is required for the public Cloudflare URL. Local LAN URLs still work on the same network.

## Development

Requirements:

- Node.js 18 or newer
- Windows for the packaged executable target

```bash
npm install
npm start
```

Build the Windows executable:

```bash
npm run build
```

The build outputs `CloudFader.exe`.

## Project Layout

| Path | Purpose |
| --- | --- |
| `launcher.js` | Portable app entry point, tunnel setup, server process management |
| `server.js` | HTTP server, audio file serving, SSE state sync API |
| `public/` | Controller and player browser UI |
| `.github/workflows/release.yml` | Tagged and manual GitHub release build |

## Release Process

Create and push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions builds `CloudFader.exe` and attaches it to the release.

## License

MIT License. Copyright Serelix Studio.
