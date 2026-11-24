# Crimson Share — consent-based browser screen sharing

A minimal one-to-one screen-sharing website using WebRTC. The participant must click **Start sharing my screen**, tick the consent statement, and approve the browser's native screen-sharing prompt. The participant can stop sharing at any time.

## Requirements

- Node.js 20+
- A server reachable by both people
- HTTPS in production (required by browsers for `getDisplayMedia`, except localhost)
- For networks where direct peer-to-peer connections are blocked, configure a TURN server (see below)

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Click **Create screen-sharing session**. Send the participant link to the person sharing; keep the viewer link private.

## Deploy on your own server

1. Point a domain to your server.
2. Install Node.js 20 or newer.
3. Upload this project and run `npm install`.
4. Start with `npm start` (use systemd, PM2, or your host's process manager to keep it running).
5. Put Nginx or Caddy in front and enable HTTPS.
6. If the app is behind a reverse proxy, set `BASE_URL=https://your-domain.example` so generated links use your public HTTPS domain.
7. Allow WebSocket upgrades for `/signal`.

Example Nginx location (inside your HTTPS server block):

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

Example environment:

```bash
BASE_URL=https://share.example.com PORT=3000 npm start
```

## How it works

- `POST /api/rooms` creates a one-hour room and two high-entropy bearer links.
- `/share` is the participant page. It only calls `getDisplayMedia()` after a direct click and explicit consent.
- `/view` is the viewer page.
- `/signal` is a WebSocket signaling endpoint. It forwards WebRTC offer/answer/ICE messages between the two authorized links.
- Screen video is peer-to-peer; the Node server does not receive, save, or record video.

## Important deployment/security notes

- Keep the viewer URL private. It is a bearer credential: anyone holding it may join as the viewer.
- Use HTTPS only in production. Do not expose the app over plain public HTTP.
- The built-in STUN server helps peers discover direct routes, but some networks require TURN. For reliability, configure your own TURN service and add its `urls`, `username`, and `credential` to the `RTCPeerConnection` configuration in `public/share.js` and `public/view.js`. Do not put long-lived TURN secrets in public client code; use short-lived TURN credentials.
- This starter keeps room tokens in memory. Restarting the server invalidates rooms; multiple app instances require shared room state or sticky routing.
- Add authentication, audit logging, abuse controls, and stricter origin/rate-limit policies before exposing this publicly.
- A participant's browser may show the entire screen, a window, or a tab depending on browser/device support. The participant chooses what to share in the browser prompt.
- No camera or microphone capture is requested. No screenshot recording or storage is implemented.
- Browser support for screen sharing varies. Desktop Chrome, Edge, and Firefox generally provide the best support. iOS browsers may not support `getDisplayMedia()`.

## Routes

- `/` — create session
- `/share?room=...&token=...` — participant portal
- `/view?room=...&token=...` — private viewer portal
- `/health` — health check
