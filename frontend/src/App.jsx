import { useEffect, useState } from "react";
import "./App.css";
import io from "socket.io-client";
import Editor, { useMonaco } from "@monaco-editor/react";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin);

const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
});
const EXECUTE_API_URL = `${SOCKET_URL}/api/execute`;
const DEFAULT_CPP_CODE = `#include <bits/stdc++.h>
using namespace std;

#define fastio() ios_base::sync_with_stdio(false); cin.tie(NULL); cout.tie(NULL)

using ll = long long;
using ld = long double;

#define pb push_back
#define ppb pop_back
#define ff first
#define ss second
#define all(x) (x).begin(), (x).end()
#define sz(x) ((int)(x).size())

void solve() {
    
}

int main() {
  fastio();
  int t = 1; cin >> t;
  while(t--) solve();
  return 0;
}`;

const App = () => {
  const monaco = useMonaco();
  const [currentPage, setCurrentPage] = useState("home"); // "home" or "editor"
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [language, setLanguage] = useState("cpp");
  const [code, setCode] = useState(DEFAULT_CPP_CODE);
  const [copySuccess, setCopySuccess] = useState("");
  const [users, setUsers] = useState([]);
  const [typing, setTyping] = useState("");
  const [programInput, setProgramInput] = useState("");
  const [programOutput, setProgramOutput] = useState(
    "Run your code to see output...",
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalWidth, setTerminalWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [theme, setTheme] = useState("orange"); // "orange" | "cyan" | "blue" | "yellow"

  const themeColors = {
    orange: "#ff8c42",
    cyan: "#4ecdc4",
    blue: "#7c8cff",
    yellow: "#e0b84f",
  };

  const themePalettes = {
    orange: {
      editorBg: "#0e0c0c",
      gutterBg: "#0e0c0c",
      lineHighlight: "#4f536b99",
    },
    cyan: {
      editorBg: "#051127",
      gutterBg: "#051127",
      lineHighlight: "#3f537280",
    },
    blue: {
      editorBg: "#0b1020",
      gutterBg: "#0b1020",
      lineHighlight: "#4f5f9e80",
    },
    yellow: {
      editorBg: "#fffdf7",
      gutterBg: "#fffdf7",
      lineHighlight: "#f6e8c0cc",
    },
  };

  useEffect(() => {
    if (!monaco) {
      return;
    }

    const isLightTheme = theme === "yellow";
    const accent = isLightTheme ? "#b8860b" : themeColors[theme] || "#ff8c42";
    const palette = themePalettes[theme] || themePalettes.orange;

    monaco.editor.defineTheme("codesync-theme", {
      base: isLightTheme ? "vs" : "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": palette.editorBg,
        "editorGutter.background": palette.gutterBg,
        "editor.foreground": isLightTheme ? "#1f2328" : "#d4d4d4",
        "editorCursor.foreground": accent,
        "editor.lineHighlightBackground": palette.lineHighlight,
        "editor.lineHighlightBorder": "#00000000",
        "editorLineNumber.activeForeground": isLightTheme
          ? "#1f2328"
          : "#ffffff",
        "editorLineNumber.foreground": isLightTheme ? "#7c7c7c" : "#7b7f95",
        "editorIndentGuide.background1": "#00000000",
        "editorIndentGuide.activeBackground1": "#00000000",
        "editorIndentGuide.background2": "#00000000",
        "editorIndentGuide.activeBackground2": "#00000000",
        "editorIndentGuide.background3": "#00000000",
        "editorIndentGuide.activeBackground3": "#00000000",
        "editorIndentGuide.background4": "#00000000",
        "editorIndentGuide.activeBackground4": "#00000000",
        "editorIndentGuide.background5": "#00000000",
        "editorIndentGuide.activeBackground5": "#00000000",
        "editorIndentGuide.background6": "#00000000",
        "editorIndentGuide.activeBackground6": "#00000000",
        "editorBracketPairGuide.background1": "#00000000",
        "editorBracketPairGuide.activeBackground1": "#00000000",
        "editorBracketPairGuide.background2": "#00000000",
        "editorBracketPairGuide.activeBackground2": "#00000000",
        "editorBracketPairGuide.background3": "#00000000",
        "editorBracketPairGuide.activeBackground3": "#00000000",
        "editorBracketPairGuide.background4": "#00000000",
        "editorBracketPairGuide.activeBackground4": "#00000000",
        "editorBracketPairGuide.background5": "#00000000",
        "editorBracketPairGuide.activeBackground5": "#00000000",
        "editorBracketPairGuide.background6": "#00000000",
        "editorBracketPairGuide.activeBackground6": "#00000000",
        "editorRuler.foreground": "#00000000",
      },
    });
  }, [monaco, theme]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      const minWidth = 300;
      const maxWidth = Math.min(700, window.innerWidth - 320);
      const nextWidth = window.innerWidth - event.clientX;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setTerminalWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  useEffect(() => {
    const handleUserJoined = (activeUsers) => {
      setUsers(activeUsers);
    };

    const handleRoomState = ({ code: roomCode, language: roomLanguage }) => {
      if (typeof roomCode === "string") {
        setCode(roomCode);
      }

      if (typeof roomLanguage === "string") {
        setLanguage(roomLanguage);
      }
    };

    const handleCodeUpdate = (newCode) => {
      setCode(newCode);
    };

    const handleUserTyping = (user) => {
      setTyping(`${user.slice(0, 8)}... is Typing`);
      setTimeout(() => setTyping(""), 2000);
    };

    const handleLanguageUpdate = (newLanguage) => {
      setLanguage(newLanguage);
    };

    socket.on("userJoined", handleUserJoined);
    socket.on("roomState", handleRoomState);
    socket.on("codeUpdate", handleCodeUpdate);
    socket.on("userTyping", handleUserTyping);
    socket.on("languageUpdate", handleLanguageUpdate);

    return () => {
      socket.off("userJoined", handleUserJoined);
      socket.off("roomState", handleRoomState);
      socket.off("codeUpdate", handleCodeUpdate);
      socket.off("userTyping", handleUserTyping);
      socket.off("languageUpdate", handleLanguageUpdate);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket.connected) {
        socket.emit("leaveRoom");
        socket.disconnect();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (socket.connected) {
        socket.emit("leaveRoom");
        socket.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    const handleConnect = () => {
      if (joined && roomId && userName) {
        socket.emit("join", {
          roomId,
          userName,
          initialCode: code,
          initialLanguage: language,
        });
      }
    };

    socket.on("connect", handleConnect);

    return () => {
      socket.off("connect", handleConnect);
    };
  }, [joined, roomId, userName, code, language]);

  const joinRoom = () => {
    if (roomId && userName) {
      setJoined(true);
      setCurrentPage("editor");
      setUsers((prev) =>
        prev.includes(userName) ? prev : [...prev, userName],
      );

      if (socket.connected) {
        socket.emit("join", {
          roomId,
          userName,
          initialCode: code,
          initialLanguage: language,
        });
      } else {
        socket.connect();
      }
    }
  };

  const leaveRoom = () => {
    if (socket.connected) {
      socket.emit("leaveRoom");
      socket.disconnect();
    }

    setJoined(false);
    setCurrentPage("home");
    setRoomId("");
    setUserName("");
    setUsers([]);
    setCode(DEFAULT_CPP_CODE);
    setLanguage("cpp");
    setProgramInput("");
    setProgramOutput("Run your code to see output...");
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopySuccess("Copied!");
    setTimeout(() => setCopySuccess(""), 2000);
  };

  const handleCodeChange = (newCode) => {
    const safeCode = newCode ?? "";
    setCode(safeCode);

    if (joined && socket.connected) {
      socket.emit("codeChange", { roomId, code: safeCode });
      socket.emit("typing", { roomId, userName });
    }
  };

  const handleLanguageChange = (e) => {
    const newLanguage = e.target.value;
    setLanguage(newLanguage);

    if (joined && socket.connected) {
      socket.emit("languageChange", { roomId, language: newLanguage });
    }
  };

  const runCode = async () => {
    if (!code.trim()) {
      setProgramOutput("Please write some code before running.");
      return;
    }

    setIsExecuting(true);
    setProgramOutput("Running...");

    try {
      const response = await fetch(EXECUTE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language,
          code,
          stdin: programInput,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to execute code");
      }

      setProgramOutput(data.output || "Program executed with no output.");
    } catch (error) {
      setProgramOutput(`Execution error: ${error.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const startPaneResize = (event) => {
    event.preventDefault();
    setIsResizing(true);
  };

  return (
    <div className="app-shell" data-theme={theme}>
      {/* Navigation Bar */}
      <nav className="navbar">
        <div className="navbar-left">
          <h1 className="navbar-brand">CodeSync</h1>
          <div className="navbar-links">
            <a
              href="#home"
              className={currentPage === "home" ? "active" : ""}
              onClick={() => {
                if (joined) setCurrentPage("home");
              }}
            >
              HOME
            </a>
            <a
              href="#editor"
              className={currentPage === "editor" ? "active" : ""}
              onClick={() => {
                if (joined) setCurrentPage("editor");
              }}
            >
              EDITOR
            </a>
          </div>
        </div>
        <div className="navbar-right">
          {currentPage === "editor" && joined && (
            <div
              className="users-nav-badge"
              title={users.length ? users.join(", ") : "No users in room"}
            >
              Users: {users.length}
            </div>
          )}
          <div className="navbar-colors">
            {Object.entries(themeColors).map(([key, color]) => (
              <button
                key={key}
                className={`color-dot ${theme === key ? "active" : ""}`}
                style={{ background: color }}
                onClick={() => setTheme(key)}
                title={`${key[0].toUpperCase()}${key.slice(1)} theme`}
              />
            ))}
          </div>
        </div>
      </nav>

      {/* Home Page */}
      {currentPage === "home" ? (
        <div className="home-container" data-theme={theme}>
          <div className="home-left">
            <h1 className="home-title">CodeSync</h1>
            <p className="home-description">
              CodeSync is a real-time web-based code editor.
            </p>
            <button
              className="home-button"
              onClick={() => {
                if (roomId && userName) {
                  joinRoom();
                } else {
                  alert("Please enter name and room ID");
                }
              }}
            >
              GET STARTED
            </button>
          </div>
          <div className="home-right">
            <div className="home-form">
              <h2>Join Code Session</h2>
              <input
                type="text"
                placeholder="Your Name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="home-input"
              />
              <input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="home-input"
              />
              <button className="home-form-button" onClick={joinRoom}>
                Join Room
              </button>
              <p className="home-hint">or click GET STARTED on the left</p>
            </div>
          </div>
        </div>
      ) : (
        /* Editor Page */
        <div className="editor-container" data-theme={theme}>
          <div
            className={`workspace-layout ${isTerminalOpen ? "" : "terminal-closed"}`}
            style={{ "--terminal-width": `${terminalWidth}px` }}
          >
            <main className="editor-wrapper">
              <Editor
                height={"100%"}
                defaultLanguage={language}
                language={language}
                value={code}
                onChange={handleCodeChange}
                theme="codesync-theme"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: "on",
                  renderLineHighlight: "all",
                  renderIndentGuides: false,
                  highlightActiveIndentGuide: false,
                  bracketPairColorization: { enabled: false },
                  matchBrackets: "never",
                  rulers: [],
                  guides: {
                    indentation: false,
                    highlightActiveIndentation: false,
                    bracketPairs: false,
                    bracketPairsHorizontal: false,
                    highlightActiveBracketPair: false,
                  },
                }}
              />
            </main>

            <div
              className={`pane-resizer ${isTerminalOpen ? "" : "hidden"}`}
              onMouseDown={startPaneResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize terminal pane"
            ></div>

            <aside
              className={`terminal-panel ${isTerminalOpen ? "open" : "collapsed"}`}
            >
              {isTerminalOpen ? (
                <>
                  <div className="terminal-controls">
                    <select
                      className="language-selector"
                      value={language}
                      onChange={handleLanguageChange}
                    >
                      <option value="javascript">JavaScript</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="cpp">C++</option>
                    </select>
                    <button
                      className="run-button compact"
                      onClick={runCode}
                      disabled={isExecuting}
                    >
                      {isExecuting ? "RUN..." : "▶ RUN"}
                    </button>
                    <button className="terminal-menu" title="More options">
                      ⋮
                    </button>
                  </div>

                  <div className="users-inline">
                    <div className="users-inline-header">
                      Users in Room ({users.length})
                    </div>
                    <div className="users-inline-list">
                      {users.length > 0 ? (
                        users.map((user, index) => (
                          <span className="users-inline-item" key={index}>
                            {user}
                          </span>
                        ))
                      ) : (
                        <span className="users-inline-item muted">
                          No users yet
                        </span>
                      )}
                    </div>
                    {typing && (
                      <div className="users-inline-typing">{typing}</div>
                    )}
                  </div>

                  <p className="io-label">Input</p>
                  <textarea
                    className="input-box"
                    placeholder="Optional stdin input..."
                    value={programInput}
                    onChange={(e) => setProgramInput(e.target.value)}
                  />

                  <p className="io-label">Output</p>
                  <div className="output-box large">
                    <pre>{programOutput}</pre>
                  </div>
                </>
              ) : (
                <></>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
