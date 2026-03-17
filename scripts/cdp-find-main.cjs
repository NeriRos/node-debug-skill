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

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === "Debugger.scriptParsed") {
        scripts.push(msg.params);
      }
      if (msg.id === 1) {
        // Debugger.enable response
        setTimeout(() => {
          // Find main.js and any webpack-internal scripts
          const mainScripts = scripts.filter(s =>
            s.url.includes("main.js") || s.url.includes("webpack")
          );
          console.log("=== MAIN/WEBPACK SCRIPTS ===");
          mainScripts.forEach(s => console.log(JSON.stringify({
            url: s.url,
            scriptId: s.scriptId,
            sourceMapURL: s.sourceMapURL,
            hasSourceMapURL: !!s.sourceMapURL,
          })));

          // Also search for any script containing 'dispatch' by trying search
          console.log("\n=== TOTAL SCRIPTS:", scripts.length);

          // Show first few and last few URLs
          console.log("\n=== FIRST 5 ===");
          scripts.slice(0, 5).forEach(s => console.log(s.url || "(empty)"));
          console.log("\n=== LAST 5 ===");
          scripts.slice(-5).forEach(s => console.log(s.url || "(empty)"));

          ws.close();
        }, 2000);
      }
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Debugger.enable", params: {} }));
    });

    ws.on("close", () => process.exit(0));
  });
});
