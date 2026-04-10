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

## Environment variables

Use `.env.example` as reference:

- `PORT`: server port (default `5000`)
- `CLIENT_URLS`: comma-separated allowed CORS origins (for API + sockets)
- `EXECUTION_TIMEOUT_MS`: execution timeout for code runner
- `COMPILATION_TIMEOUT_MS`: compile timeout for Java/C++ compilation steps
- `MAX_CODE_LENGTH`: max accepted source code length
- `MAX_STDIN_LENGTH`: max accepted stdin input length
- `MAX_OUTPUT_BYTES`: max combined stdout/stderr size per execution
- `MAX_CONCURRENT_EXECUTIONS`: max simultaneous code executions
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS`: global API rate limiting
- `EXECUTE_RATE_LIMIT_WINDOW_MS` and `EXECUTE_RATE_LIMIT_MAX_REQUESTS`: stricter execution route rate limiting
- `ALLOW_UNSANDBOXED_EXECUTION`: production safety gate for `/api/execute`
- `EXECUTE_API_KEY`: optional shared secret required in `x-execute-api-key`
- `VITE_SOCKET_URL`: optional frontend socket/API URL override

> In production, if frontend and backend are deployed together, keep `VITE_SOCKET_URL` empty so frontend uses current origin.

## Deployment checklist

- Ensure build command runs successfully: `npm run build`
- Ensure start command boots server: `npm start`
- Configure environment variables from `.env.example`
- Verify health endpoint: `/api/health`
- Verify collaboration and code execution from browser

## Notes on code execution

The server executes user-submitted code on the host machine. For public deployments, run inside an isolated/sandboxed environment (container/jail).

This project now includes:

- Security headers via Helmet
- API and execution-specific rate limiting
- Optional execution API key protection
- Code/input/output/concurrency guardrails
- Production execution gate (`ALLOW_UNSANDBOXED_EXECUTION`)

Recommended production setup:

1. Deploy execution in an isolated sandbox/container runtime.
2. Set `ALLOW_UNSANDBOXED_EXECUTION=false` until sandboxing is verified.
3. Configure `EXECUTE_API_KEY` and send it from trusted clients/services.
4. Keep strict `CLIENT_URLS` values (avoid `*` in production).
