const http = require("http");
const WebSocket = require(
  require.resolve("ws", {
    paths: [__dirname + "/../node_modules/.pnpm/ws@8.18.3/node_modules"],
  })
);

http.get("http://localhost:9229/json", (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const targets = JSON.parse(data);
    const wsUrl = targets[0].webSocketDebuggerUrl;
    console.log("Connecting to:", wsUrl);
    connectAndSetBreakpoints(wsUrl);
  });
});

function connectAndSetBreakpoints(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve) => {
      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          ws.off("message", handler);
          resolve(msg);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on("open", async () => {
    console.log("Connected to debugger\n");

    await send("Debugger.enable");
    console.log("Debugger enabled\n");

    // CDP line numbers are 0-indexed
    const breakpoints = [
      {
        label: "StripeWebhookCoordinator.dispatch()",
        urlRegex: "stripeWebhookCoordinator\\.ts",
        lineNumber: 58,
      },
      {
        label: "StripeWebhookCoordinator consumer handler",
        urlRegex: "stripeWebhookCoordinator\\.ts",
        lineNumber: 96,
      },
      {
        label: "BaseStripeWebhookHandler.handle()",
        urlRegex: "stripeWebhookHandler\\.ts",
        lineNumber: 68,
      },
      {
        label: "StripeTreasuryWebhookAdapter.shouldHandle()",
        urlRegex: "StripeWebhook\\.adapter\\.ts",
        lineNumber: 64,
      },
    ];

    for (const bp of breakpoints) {
      const result = await send("Debugger.setBreakpointByUrl", {
        urlRegex: bp.urlRegex,
        lineNumber: bp.lineNumber,
        columnNumber: 0,
      });

      if (result.result && result.result.breakpointId) {
        const locations = result.result.locations || [];
        const loc = locations[0];
        console.log(
          `  SET: ${bp.label}\n` +
            `       breakpointId=${result.result.breakpointId}` +
            (loc ? `\n       resolved: line ${loc.lineNumber + 1}` : "\n       (pending - will resolve when file loads)") +
            "\n"
        );
      } else {
        console.log(`  FAIL: ${bp.label} -> ${JSON.stringify(result.error || result)}\n`);
      }
    }

    console.log("All breakpoints set. Disconnecting (breakpoints persist on server).");
    ws.close();
  });

  ws.on("close", () => {
    console.log("Done.");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    process.exit(1);
  });
}
