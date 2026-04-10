# CodeSync Realtime Code Editor

CodeSync is a real-time web-based code editor.

Production-ready setup for a full-stack realtime collaborative code editor:

- **Frontend**: React + Vite + Monaco
- **Backend**: Node.js + Express + Socket.IO
- **Code execution**: local runtime execution for JavaScript, Python, Java, C++

## Local development

1. Install dependencies at project root.
2. Start backend dev server.
3. In a second terminal, start frontend dev server.

Environment values are in `.env` (local) and `.env.example` (template).

## Production build & run

- Build frontend assets:
  - `npm run build`
- Start backend server (serves `frontend/dist`):
  - `npm start`

The backend serves the compiled frontend and Socket/API from the same origin.

## Deployment note

Socket.IO requires a live Node server with persistent connections.

- If the frontend is deployed separately, set `VITE_SOCKET_URL` to the backend URL.
- Set `CLIENT_URLS` on the backend to the deployed frontend origin.
- A frontend-only static deployment will not host the socket server.
