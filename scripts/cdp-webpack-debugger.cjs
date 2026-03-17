const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require(
  require.resolve("ws", {
    paths: [__dirname + "/../node_modules/.pnpm/ws@8.18.3/node_modules"],
  })
);

const STATE_FILE = path.join(__dirname, "debugger-state.json");
const CMD_FILE = path.join(__dirname, "debugger-cmd");
try { fs.unlinkSync(STATE_FILE); } catch {}
try { fs.unlinkSync(CMD_FILE); } catch {}

function writeState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function waitForInspector(cb) {
  const tryConnect = () => {
    http.get("http://127.0.0.1:9229/json", (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { cb(JSON.parse(d)[0].webSocketDebuggerUrl); } catch { setTimeout(tryConnect, 1000); } });
    }).on("error", () => setTimeout(tryConnect, 1000));
  };
  tryConnect();
}

console.log("Waiting for inspector...");
writeState({ status: "waiting_for_inspector" });

waitForInspector(wsUrl => {
  console.log("Inspector:", wsUrl);
  run(wsUrl);
});

function run(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();
  const allScripts = new Map(); // scriptId -> { url, source loaded? }
  let currentCallFrames = null;

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise(resolve => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function getScriptSource(scriptId) {
    const r = await send("Debugger.getScriptSource", { scriptId });
    return r.result?.scriptSource || "";
  }

  async function findLineInScript(scriptId, searchText) {
    const source = await getScriptSource(scriptId);
    const lines = source.split("\n");
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchText)) {
        matches.push({ line: i, text: lines[i].trim().substring(0, 100) });
      }
    }
    return matches;
  }

  async function getProperties(objectId) {
    const r = await send("Runtime.getProperties", { objectId, ownProperties: true, generatePreview: true });
    const props = {};
    for (const p of r.result?.result || []) {
      if (!p.value) continue;
      if (p.value.type === "object" && p.value.preview) {
        const pp = (p.value.preview.properties || []).slice(0, 8).map(x => `${x.name}: ${x.value}`).join(", ");
        props[p.name] = `{${pp}}`;
      } else if (p.value.type === "function") {
        props[p.name] = "[Function]";
      } else {
        props[p.name] = p.value.value ?? `[${p.value.type}: ${p.value.description || ""}]`;
      }
    }
    return props;
  }

  async function evaluateOnFrame(callFrameId, expression) {
    const r = await send("Debugger.evaluateOnCallFrame", { callFrameId, expression, returnByValue: true });
    if (r.result?.result?.type === "object" && !r.result?.result?.value) return r.result?.result?.description || "[object]";
    return r.result?.result?.value ?? r.result?.result?.description ?? r.result?.exceptionDetails?.text ?? null;
  }

  async function buildPausedState(params) {
    const callFrames = params.callFrames;
    currentCallFrames = callFrames;
    const frames = [];
    for (const frame of callFrames.slice(0, 5)) {
      const f = { functionName: frame.functionName || "(anonymous)", url: frame.url?.split("/").pop() || frame.url, line: frame.location.lineNumber + 1 };
      for (const scope of frame.scopeChain) {
        if (scope.type === "local" && scope.object?.objectId) f.locals = await getProperties(scope.object.objectId);
      }
      frames.push(f);
    }
    const topId = callFrames[0]?.callFrameId;
    const evaluated = {};
    if (topId) {
      try { evaluated["event?.type"] = await evaluateOnFrame(topId, "typeof event !== 'undefined' ? event?.type : (typeof evt !== 'undefined' ? evt?.type : undefined)"); } catch {}
      try { evaluated["event?.id"] = await evaluateOnFrame(topId, "typeof event !== 'undefined' ? event?.id : (typeof evt !== 'undefined' ? evt?.id : undefined)"); } catch {}
      try { evaluated["this?.name"] = await evaluateOnFrame(topId, "this?.name"); } catch {}
    }
    return { status: "paused", reason: params.reason, hitBreakpoints: params.hitBreakpoints, frames, evaluated, timestamp: new Date().toISOString() };
  }

  function pollForCommand(state) {
    const poll = setInterval(async () => {
      if (!fs.existsSync(CMD_FILE)) return;
      const cmd = fs.readFileSync(CMD_FILE, "utf8").trim();
      fs.unlinkSync(CMD_FILE);
      if (cmd === "resume") { clearInterval(poll); console.log(">>> RESUME"); writeState({ status: "running" }); await send("Debugger.resume"); }
      else if (cmd === "stepOver") { clearInterval(poll); console.log(">>> STEP OVER"); await send("Debugger.stepOver"); }
      else if (cmd === "stepInto") { clearInterval(poll); console.log(">>> STEP INTO"); await send("Debugger.stepInto"); }
      else if (cmd === "stepOut") { clearInterval(poll); console.log(">>> STEP OUT"); await send("Debugger.stepOut"); }
      else if (cmd.startsWith("eval:")) {
        const expr = cmd.slice(5);
        const topId = currentCallFrames?.[0]?.callFrameId;
        if (topId) {
          const val = await evaluateOnFrame(topId, expr);
          console.log(`>>> EVAL: ${expr} = ${JSON.stringify(val)}`);
          state.lastEval = { expression: expr, result: val };
          writeState(state);
        }
      }
    }, 300);
  }

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Debugger.scriptParsed") {
      allScripts.set(msg.params.scriptId, { url: msg.params.url, sourceMapURL: msg.params.sourceMapURL });
    }
    if (msg.method === "Debugger.paused") {
      console.log("\n=== PAUSED ===");
      console.log("Top:", msg.params.callFrames[0]?.functionName, "line", msg.params.callFrames[0]?.location.lineNumber + 1);
      const state = await buildPausedState(msg.params);
      writeState(state);
      console.log("State written. Waiting for command...");
      pollForCommand(state);
    }
    if (msg.method === "Debugger.resumed") { console.log("=== RESUMED ==="); writeState({ status: "running" }); }
  });

  ws.on("open", async () => {
    console.log("Connected");
    await send("Debugger.enable");
    await send("Runtime.enable");

    // Wait for scripts to be parsed
    await new Promise(r => setTimeout(r, 3000));
    console.log(`Total scripts loaded: ${allScripts.size}`);

    // Find main.js (the webpack bundle)
    let mainScriptId = null;
    for (const [id, info] of allScripts) {
      if (info.url.includes("main.js") && info.sourceMapURL) {
        mainScriptId = id;
        console.log(`Found main.js: scriptId=${id}, url=${info.url}`);
        break;
      }
    }

    if (!mainScriptId) {
      // Try any large script
      for (const [id, info] of allScripts) {
        if (info.url.includes("main.js")) {
          mainScriptId = id;
          console.log(`Found main.js (no sourcemap): scriptId=${id}, url=${info.url}`);
          break;
        }
      }
    }

    if (!mainScriptId) {
      console.log("ERROR: Could not find main.js bundle");
      writeState({ status: "error", error: "main.js not found" });
      ws.close();
      return;
    }

    // Search for our functions in the compiled bundle
    const searches = [
      { label: "Coordinator.dispatch()", search: "async dispatch(event)" },
      { label: "Handler.handle()", search: "async handle(event)" },
      { label: "Treasury.shouldHandle()", search: "hasFinancialAccount(event)" },
    ];

    const breakpointsSet = [];
    for (const s of searches) {
      const matches = await findLineInScript(mainScriptId, s.search);
      if (matches.length > 0) {
        const match = matches[0];
        const r = await send("Debugger.setBreakpoint", {
          location: { scriptId: mainScriptId, lineNumber: match.line, columnNumber: 0 },
        });
        const bp = r.result?.actualLocation;
        console.log(`  BP: ${s.label} -> line ${match.line + 1} "${match.text}" -> ${bp ? "SET at line " + (bp.lineNumber + 1) : "FAIL"}`);
        breakpointsSet.push({ label: s.label, line: match.line + 1, text: match.text });
      } else {
        console.log(`  MISS: ${s.label} - "${s.search}" not found in bundle`);
      }
    }

    writeState({ status: "running", message: "Breakpoints set.", breakpoints: breakpointsSet });
    console.log("\nReady. Waiting for breakpoint hits...");
  });

  ws.on("close", () => { writeState({ status: "disconnected" }); process.exit(0); });
  ws.on("error", e => { console.error("WS error:", e.message); writeState({ status: "error", error: e.message }); process.exit(1); });
  process.on("SIGTERM", () => send("Debugger.disable").then(() => ws.close()));
  process.on("SIGINT", () => send("Debugger.disable").then(() => ws.close()));
}
