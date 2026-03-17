# CDP Agent Script Template

Save as `.context/cdp-agent.cjs` in your project. Customize the `searches` array.

## Script

```javascript
const http = require("http");
const fs = require("fs");
const path = require("path");

// Auto-resolve ws: tries direct require, then searches pnpm store
function resolveWs() {
  const candidates = [
    () => require.resolve("ws"),
    () => {
      const { execSync } = require("child_process");
      const result = execSync(
        'find node_modules/.pnpm -path "*/ws/lib/websocket.js" -maxdepth 5 2>/dev/null | head -1',
        { encoding: "utf8" },
      ).trim();
      if (!result) throw new Error("not found");
      return require("path").resolve(result, "../../");
    },
  ];
  for (const tryResolve of candidates) {
    try {
      return require(tryResolve());
    } catch {}
  }
  throw new Error(
    "Could not find 'ws' package. Run: find node_modules -name ws -type d -maxdepth 5",
  );
}
const WebSocket = resolveWs();

const MAX_FRAMES = 8;
const STATE_FILE = path.join(__dirname, "debugger-state.json");
const CMD_FILE = path.join(__dirname, "debugger-cmd");
try {
  fs.unlinkSync(STATE_FILE);
} catch {}
try {
  fs.unlinkSync(CMD_FILE);
} catch {}

function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function waitForInspector(cb) {
  const tryConnect = () => {
    http
      .get("http://127.0.0.1:9229/json", (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            cb(JSON.parse(d)[0].webSocketDebuggerUrl);
          } catch {
            setTimeout(tryConnect, 1000);
          }
        });
      })
      .on("error", () => setTimeout(tryConnect, 1000));
  };
  tryConnect();
}

console.log("Waiting for inspector...");
writeState({ status: "waiting_for_inspector" });
waitForInspector((wsUrl) => {
  console.log("Inspector:", wsUrl);
  run(wsUrl);
});

function run(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();
  const allScripts = new Map();
  let currentCallFrames = null;
  const breakpointIdsByLabel = new Map(); // label -> breakpointId
  const breakpointConfigs = new Map(); // breakpointId -> { label, condition }

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Uses CDP server-side search — no need to download the full bundle
  async function findLineInScript(scriptId, searchText) {
    const r = await send("Debugger.searchInContent", {
      scriptId,
      query: searchText,
      caseSensitive: true,
    });
    return (r.result?.result || []).map((m) => ({
      line: m.lineNumber,
      text: m.lineContent.trim().substring(0, 120),
    }));
  }

  async function getProperties(objectId) {
    const r = await send("Runtime.getProperties", {
      objectId,
      ownProperties: true,
      generatePreview: true,
    });
    const props = {};
    for (const p of r.result?.result || []) {
      if (!p.value) continue;
      if (p.value.type === "object" && p.value.preview) {
        const pp = (p.value.preview.properties || [])
          .slice(0, 8)
          .map((x) => `${x.name}: ${x.value}`)
          .join(", ");
        props[p.name] = `{${pp}}`;
      } else if (p.value.type === "function") {
        props[p.name] = "[Function]";
      } else {
        props[p.name] =
          p.value.value ?? `[${p.value.type}: ${p.value.description || ""}]`;
      }
    }
    return props;
  }

  async function evaluateOnFrame(callFrameId, expression) {
    const r = await send("Debugger.evaluateOnCallFrame", {
      callFrameId,
      expression,
      returnByValue: true,
    });
    if (r.result?.result?.type === "object" && !r.result?.result?.value)
      return r.result?.result?.description || "[object]";
    return (
      r.result?.result?.value ??
      r.result?.result?.description ??
      r.result?.exceptionDetails?.text ??
      null
    );
  }

  async function buildPausedState(params) {
    const callFrames = params.callFrames;
    currentCallFrames = callFrames;
    const frames = [];
    for (const frame of callFrames.slice(0, MAX_FRAMES)) {
      const f = {
        functionName: frame.functionName || "(anonymous)",
        url: frame.url?.split("/").pop() || frame.url,
        line: frame.location.lineNumber + 1,
      };
      for (const scope of frame.scopeChain) {
        if (scope.type === "local" && scope.object?.objectId)
          f.locals = await getProperties(scope.object.objectId);
      }
      frames.push(f);
    }
    const topId = callFrames[0]?.callFrameId;
    const evaluated = {};
    if (topId) {
      // ============================================
      // CUSTOMIZE: Add auto-eval expressions here
      // These run automatically when any breakpoint hits
      // ============================================
      try {
        evaluated["event?.type"] = await evaluateOnFrame(
          topId,
          "typeof event !== 'undefined' ? event?.type : undefined",
        );
      } catch {}
      try {
        evaluated["event?.id"] = await evaluateOnFrame(
          topId,
          "typeof event !== 'undefined' ? event?.id : undefined",
        );
      } catch {}
      try {
        evaluated["this?.name"] = await evaluateOnFrame(topId, "this?.name");
      } catch {}
    }
    return {
      status: "paused",
      reason: params.reason,
      hitBreakpoints: params.hitBreakpoints,
      frames,
      evaluated,
      timestamp: new Date().toISOString(),
    };
  }

  function pollForCommand(state) {
    const poll = setInterval(async () => {
      if (!fs.existsSync(CMD_FILE)) return;
      const cmd = fs.readFileSync(CMD_FILE, "utf8").trim();
      fs.unlinkSync(CMD_FILE);
      if (cmd === "resume") {
        clearInterval(poll);
        writeState({ status: "running" });
        await send("Debugger.resume");
      } else if (cmd === "stepOver") {
        clearInterval(poll);
        await send("Debugger.stepOver");
      } else if (cmd === "stepInto") {
        clearInterval(poll);
        await send("Debugger.stepInto");
      } else if (cmd === "stepOut") {
        clearInterval(poll);
        await send("Debugger.stepOut");
      } else if (cmd.startsWith("eval:")) {
        const expr = cmd.slice(5);
        const topId = currentCallFrames?.[0]?.callFrameId;
        if (topId) {
          const val = await evaluateOnFrame(topId, expr);
          state.lastEval = { expression: expr, result: val };
          writeState(state);
        }
      } else if (cmd.startsWith("disable:")) {
        const label = cmd.slice(8);
        const bpId = breakpointIdsByLabel.get(label);
        if (bpId) {
          await send("Debugger.removeBreakpoint", { breakpointId: bpId });
          breakpointIdsByLabel.delete(label);
          breakpointConfigs.delete(bpId);
          state.disabledBreakpoints = (state.disabledBreakpoints || []).concat(
            label,
          );
          writeState(state);
        }
      }
    }, 300);
  }

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Debugger.scriptParsed") {
      allScripts.set(msg.params.scriptId, {
        url: msg.params.url,
        sourceMapURL: msg.params.sourceMapURL,
      });
    }
    if (msg.method === "Debugger.paused") {
      // Check conditional breakpoints — auto-resume if condition not met
      const hitBpId = msg.params.hitBreakpoints?.[0];
      const bpConfig = hitBpId ? breakpointConfigs.get(hitBpId) : null;
      if (bpConfig?.condition) {
        const topId = msg.params.callFrames[0]?.callFrameId;
        if (topId) {
          const condResult = await evaluateOnFrame(topId, bpConfig.condition);
          if (!condResult) {
            await send("Debugger.resume");
            return; // skip this hit
          }
        }
      }

      console.log(
        "\n=== PAUSED ===",
        msg.params.callFrames[0]?.functionName,
        "line",
        msg.params.callFrames[0]?.location.lineNumber + 1,
      );
      const state = await buildPausedState(msg.params);
      writeState(state);
      pollForCommand(state);
    }
    if (msg.method === "Debugger.resumed") {
      writeState({ status: "running" });
    }
  });

  ws.on("open", async () => {
    console.log("Connected");
    await send("Debugger.enable");
    await send("Runtime.enable");
    await new Promise((r) => setTimeout(r, 3000));

    // Find webpack bundle
    let mainScriptId = null;
    for (const [id, info] of allScripts) {
      if (info.url.includes("main.js")) {
        mainScriptId = id;
        break;
      }
    }

    if (!mainScriptId) {
      console.log(
        "ERROR: main.js not found. If not using webpack, use setBreakpointByUrl instead.",
      );
      writeState({ status: "error", error: "main.js not found" });
      ws.close();
      return;
    }

    // ============================================
    // CUSTOMIZE: Your breakpoint search strings
    // Add a `condition` field to auto-resume when the condition is falsy
    // ============================================
    const searches = [
      // { label: "Friendly name", search: "unique text from your function" },
      // { label: "Handler.handle()", search: "async handle(event)", condition: 'event?.type === "treasury.received_credit.created"' },
      { label: "Example", search: "async myFunction(" },
    ];

    const bpsSet = [];
    for (const s of searches) {
      const matches = await findLineInScript(mainScriptId, s.search);
      if (matches.length > 0) {
        const m = matches[0];
        const r = await send("Debugger.setBreakpoint", {
          location: {
            scriptId: mainScriptId,
            lineNumber: m.line,
            columnNumber: 0,
          },
        });
        const bpId = r.result?.breakpointId;
        const bp = r.result?.actualLocation;
        console.log(
          `  BP: ${s.label} -> line ${m.line + 1} "${m.text}" -> ${bp ? "OK" : "FAIL"}`,
        );
        if (bpId) {
          breakpointIdsByLabel.set(s.label, bpId);
          if (s.condition)
            breakpointConfigs.set(bpId, {
              label: s.label,
              condition: s.condition,
            });
        }
        bpsSet.push({ label: s.label, line: m.line + 1, text: m.text });
      } else {
        console.log(`  MISS: ${s.label} - "${s.search}" not found`);
      }
    }

    writeState({ status: "running", breakpoints: bpsSet });
    console.log("\nReady.");
  });

  ws.on("close", () => {
    console.log("Disconnected. Reconnecting in 3s...");
    writeState({ status: "reconnecting" });
    pending.clear();
    setTimeout(() => waitForInspector((newWsUrl) => run(newWsUrl)), 3000);
  });
  ws.on("error", (e) => {
    writeState({ status: "error", error: e.message });
  });
  process.on("SIGTERM", () =>
    send("Debugger.disable")
      .then(() => ws.close())
      .then(() => process.exit(0)),
  );
  process.on("SIGINT", () =>
    send("Debugger.disable")
      .then(() => ws.close())
      .then(() => process.exit(0)),
  );
}
```
