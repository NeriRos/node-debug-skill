const http = require("http");
const WebSocket = require(
  require.resolve("ws", {
    paths: [__dirname + "/../node_modules/.pnpm/ws@8.18.3/node_modules"],
  })
);

http.get("http://localhost:9229/json", (res) => {
  let data = "";
  res.on("data", (c) => (data += c));
  res.on("end", () => {
    const wsUrl = JSON.parse(data)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const scripts = [];

    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve) => {
        const handler = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) { ws.off("message", handler); resolve(msg); }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === "Debugger.scriptParsed") {
        scripts.push({ url: msg.params.url, scriptId: msg.params.scriptId, sourceMapURL: msg.params.sourceMapURL });
      }
    });

    ws.on("open", async () => {
      await send("Debugger.enable");
      // Give time for all scriptParsed events
      setTimeout(() => {
        // Filter for stripe-related or webhook-related
        const relevant = scripts.filter(s =>
          s.url.includes("stripe") || s.url.includes("Webhook") || s.url.includes("webhook") ||
          s.url.includes("Coordinator") || s.url.includes("coordinator")
        );
        console.log("=== RELEVANT SCRIPTS ===");
        relevant.forEach(s => console.log(JSON.stringify(s)));
        console.log("\n=== ALL SCRIPT URLs (first 20) ===");
        scripts.slice(0, 20).forEach(s => console.log(s.url || "(no url)"));
        console.log("Total scripts:", scripts.length);
        ws.close();
      }, 2000);
    });

    ws.on("close", () => process.exit(0));
  });
});
