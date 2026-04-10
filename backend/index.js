import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";

const app = express();
app.set("trust proxy", 1);

const toPositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallbackValue;
};

const toBoolean = (value, fallbackValue = false) => {
  if (typeof value !== "string") {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const executionTimeoutMs = toPositiveInt(
  process.env.EXECUTION_TIMEOUT_MS,
  8000,
);
const compilationTimeoutMs = toPositiveInt(
  process.env.COMPILATION_TIMEOUT_MS,
  15000,
);
const maxCodeLength = toPositiveInt(process.env.MAX_CODE_LENGTH, 100000);
const maxStdinLength = toPositiveInt(process.env.MAX_STDIN_LENGTH, 20000);
const maxOutputBytes = toPositiveInt(process.env.MAX_OUTPUT_BYTES, 200000);
const maxConcurrentExecutions = toPositiveInt(
  process.env.MAX_CONCURRENT_EXECUTIONS,
  2,
);
const executeApiKey = process.env.EXECUTE_API_KEY || "";
const allowUnsandboxedExecution = toBoolean(
  process.env.ALLOW_UNSANDBOXED_EXECUTION,
  false,
);
const isProduction = process.env.NODE_ENV === "production";
let activeExecutionCount = 0;

const getAllowedOrigins = () => {
  const rawOrigins = process.env.CLIENT_URLS || process.env.CLIENT_URL || "*";

  if (rawOrigins.trim() === "*") {
    return "*";
  }

  return rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedOrigins = getAllowedOrigins();

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  if (allowedOrigins === "*") {
    return true;
  }

  return allowedOrigins.includes(origin);
};

const apiRateLimiter = rateLimit({
  windowMs: toPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toPositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 300),
  standardHeaders: true,
  legacyHeaders: false,
});

const executeRateLimiter = rateLimit({
  windowMs: toPositiveInt(process.env.EXECUTE_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  max: toPositiveInt(process.env.EXECUTE_RATE_LIMIT_MAX_REQUESTS, 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many execution requests. Please wait a bit and try again.",
  },
});

const requireExecuteApiKey = (req, res, next) => {
  if (!executeApiKey) {
    return next();
  }

  const providedApiKey = req.get("x-execute-api-key");
  if (providedApiKey !== executeApiKey) {
    return res.status(401).json({ error: "Unauthorized execution request." });
  }

  return next();
};

const requireExecutionSafetyAcknowledgement = (req, res, next) => {
  if (!isProduction) {
    return next();
  }

  if (allowUnsandboxedExecution) {
    return next();
  }

  return res.status(503).json({
    error:
      "Code execution is disabled in production by default. Enable ALLOW_UNSANDBOXED_EXECUTION=true only when your runtime is sandboxed.",
  });
};

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use("/api", apiRateLimiter);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
  },
});

const rooms = new Map();
const roomStates = new Map();

const createMissingRuntimeError = (message) => {
  const error = new Error(message);
  error.code = "RUNTIME_NOT_FOUND";
  return error;
};

const runProcess = (
  command,
  args,
  { cwd, stdin = "", timeoutMs = 10000, maxOutputBytes: outputLimit } = {},
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const failAndKill = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();

      if (
        Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") >
        outputLimit
      ) {
        failAndKill(
          new Error(`Execution output exceeded limit of ${outputLimit} bytes.`),
        );
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();

      if (
        Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") >
        outputLimit
      ) {
        failAndKill(
          new Error(`Execution output exceeded limit of ${outputLimit} bytes.`),
        );
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }

    child.stdin.end();
  });

const runWithFallbacks = async ({
  commands,
  args,
  cwd,
  stdin,
  timeoutMs,
  maxOutputBytes: outputLimit,
  missingRuntimeMessage,
}) => {
  let lastError = null;

  for (const command of commands) {
    try {
      return await runProcess(command, args, {
        cwd,
        stdin,
        timeoutMs,
        maxOutputBytes: outputLimit,
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        lastError = error;
        continue;
      }

      throw error;
    }
  }

  throw createMissingRuntimeError(
    missingRuntimeMessage || lastError?.message || "Runtime not found",
  );
};

const getJavaClassName = (sourceCode) => {
  const match = sourceCode.match(/public\s+class\s+([A-Za-z_$][\w$]*)/);
  return match?.[1] || "Main";
};

const executeCode = async ({ language, code, stdin }) => {
  if (code.length > maxCodeLength) {
    throw new Error(
      `Code is too large. Max allowed size is ${maxCodeLength} characters.`,
    );
  }

  if (stdin.length > maxStdinLength) {
    throw new Error(
      `Input is too large. Max allowed size is ${maxStdinLength} characters.`,
    );
  }

  const workDir = path.join(os.tmpdir(), `rce-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    if (language === "javascript") {
      const filePath = path.join(workDir, "main.js");
      await fs.writeFile(filePath, code, "utf8");

      const result = await runWithFallbacks({
        commands: ["node"],
        args: [filePath],
        cwd: workDir,
        stdin,
        timeoutMs: executionTimeoutMs,
        maxOutputBytes,
        missingRuntimeMessage:
          "Node.js runtime not found. Install Node.js to run JavaScript.",
      });

      return result;
    }

    if (language === "python") {
      const filePath = path.join(workDir, "main.py");
      await fs.writeFile(filePath, code, "utf8");

      const result = await runWithFallbacks({
        commands: ["python", "py", "python3"],
        args: [filePath],
        cwd: workDir,
        stdin,
        timeoutMs: executionTimeoutMs,
        maxOutputBytes,
        missingRuntimeMessage:
          "Python runtime not found. Install Python to run Python code.",
      });

      return result;
    }

    if (language === "java") {
      const className = getJavaClassName(code);
      const fileName = `${className}.java`;
      const filePath = path.join(workDir, fileName);
      await fs.writeFile(filePath, code, "utf8");

      const compile = await runWithFallbacks({
        commands: ["javac"],
        args: [fileName],
        cwd: workDir,
        timeoutMs: compilationTimeoutMs,
        maxOutputBytes,
        missingRuntimeMessage:
          "Java compiler not found. Install JDK (javac + java).",
      });

      if (compile.exitCode !== 0) {
        return compile;
      }

      const run = await runWithFallbacks({
        commands: ["java"],
        args: [className],
        cwd: workDir,
        stdin,
        timeoutMs: executionTimeoutMs,
        maxOutputBytes,
        missingRuntimeMessage:
          "Java runtime not found. Install JDK/JRE (java).",
      });

      return {
        exitCode: run.exitCode,
        stdout: `${compile.stdout || ""}${run.stdout || ""}`,
        stderr: `${compile.stderr || ""}${run.stderr || ""}`,
      };
    }

    if (language === "cpp") {
      const sourcePath = path.join(workDir, "main.cpp");
      const executableName = process.platform === "win32" ? "main.exe" : "main";
      await fs.writeFile(sourcePath, code, "utf8");

      const compile = await runWithFallbacks({
        commands: ["g++", "clang++"],
        args: ["main.cpp", "-o", executableName],
        cwd: workDir,
        timeoutMs: compilationTimeoutMs,
        maxOutputBytes,
        missingRuntimeMessage: "C++ compiler not found. Install g++/clang++.",
      });

      if (compile.exitCode !== 0) {
        return compile;
      }

      const run = await runProcess(path.join(workDir, executableName), [], {
        cwd: workDir,
        stdin,
        timeoutMs: executionTimeoutMs,
        maxOutputBytes,
      });

      return {
        exitCode: run.exitCode,
        stdout: `${compile.stdout || ""}${run.stdout || ""}`,
        stderr: `${compile.stderr || ""}${run.stderr || ""}`,
      };
    }

    throw new Error("Unsupported language selected");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
};

app.post(
  "/api/execute",
  executeRateLimiter,
  requireExecuteApiKey,
  requireExecutionSafetyAcknowledgement,
  async (req, res) => {
    try {
      const { language, code, stdin = "" } = req.body;

      if (!language || typeof code !== "string") {
        return res
          .status(400)
          .json({ error: "language and code are required" });
      }

      if (typeof stdin !== "string") {
        return res.status(400).json({ error: "stdin must be a string" });
      }

      if (!["javascript", "python", "java", "cpp"].includes(language)) {
        return res.status(400).json({ error: "Unsupported language selected" });
      }

      if (activeExecutionCount >= maxConcurrentExecutions) {
        return res.status(429).json({
          error: "Execution queue is full. Please wait a moment and try again.",
        });
      }

      activeExecutionCount += 1;

      try {
        const result = await executeCode({ language, code, stdin });
        const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

        if (result.exitCode !== 0) {
          return res.status(200).json({
            output: output || `Program exited with code ${result.exitCode}`,
          });
        }

        return res.status(200).json({
          output: output || "Program executed with no output.",
        });
      } finally {
        activeExecutionCount = Math.max(0, activeExecutionCount - 1);
      }
    } catch (error) {
      const errorMessage =
        error.code === "RUNTIME_NOT_FOUND"
          ? error.message
          : "Failed to execute code. Please try again.";

      return res.status(500).json({ error: errorMessage });
    }
  },
);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeExecutions: activeExecutionCount,
  });
});

const removeUserFromRoom = ({ roomId, userName }) => {
  if (!roomId || !userName) {
    return;
  }

  const roomUsers = rooms.get(roomId);
  if (!roomUsers) {
    return;
  }

  roomUsers.delete(userName);

  if (roomUsers.size === 0) {
    rooms.delete(roomId);
    roomStates.delete(roomId);
    return;
  }

  io.to(roomId).emit("userJoined", Array.from(roomUsers));
};

io.on("connection", (socket) => {
  console.log("User Connected", socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on("join", ({ roomId, userName, initialCode = "", initialLanguage = "cpp" }) => {
    if (currentRoom) {
      socket.leave(currentRoom);
      removeUserFromRoom({ roomId: currentRoom, userName: currentUser });
    }

    currentRoom = roomId;
    currentUser = userName;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    if (!roomStates.has(roomId)) {
      roomStates.set(roomId, {
        code: initialCode,
        language: initialLanguage,
      });
    }

    rooms.get(roomId).add(userName);

    io.to(roomId).emit("userJoined", Array.from(rooms.get(currentRoom)));
    socket.emit("roomState", roomStates.get(roomId));
  });

  socket.on("codeChange", ({ roomId, code }) => {
    if (roomStates.has(roomId)) {
      roomStates.get(roomId).code = code;
    }

    socket.to(roomId).emit("codeUpdate", code);
  });

  socket.on("leaveRoom", () => {
    if (currentRoom && currentUser) {
      removeUserFromRoom({ roomId: currentRoom, userName: currentUser });

      socket.leave(currentRoom);

      currentRoom = null;
      currentUser = null;
    }
  });

  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  socket.on("languageChange", ({ roomId, language }) => {
    if (roomStates.has(roomId)) {
      roomStates.get(roomId).language = language;
    }

    io.to(roomId).emit("languageUpdate", language);
  });

  socket.on("disconnect", () => {
    if (currentRoom && currentUser) {
      removeUserFromRoom({ roomId: currentRoom, userName: currentUser });
    }
    console.log("user Disconnected");
  });
});

const port = process.env.PORT || 5000;

const __dirname = path.resolve();

app.use(express.static(path.join(__dirname, "/frontend/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other process or set a different PORT.`,
    );
    process.exit(1);
  }

  console.error("Server failed to start:", error.message);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`server is working on port ${port}`);
});
