# Gotchas & Hard-Won Lessons

## 1. Inspector Connection Exclusivity

Node.js `--inspect` allows only ONE active debugger WebSocket connection.

**Symptoms:**

- `ECONNREFUSED` when trying to connect, even though `lsof` shows the port in use
- `lsof -i:9229` shows `ESTABLISHED` but no `LISTEN`

**What happens:**

1. Chrome DevTools or `chrome://inspect` auto-connects to the inspector
2. Node.js closes the LISTEN socket (no more new connections accepted)
3. Your CDP agent gets connection refused

**Fix:**

- Start the CDP agent BEFORE Chrome. The agent's polling loop handles the race.
- If Chrome already grabbed it: restart the server, close `chrome://inspect` tabs
- Killing the Chrome helper process that holds the connection also works but may crash Chrome

## 2. `ws` Package in pnpm Monorepos

pnpm uses strict symlink isolation. Scripts outside `node_modules` can't `import "ws"` or `require("ws")`.

**Fix:** The agent now auto-resolves `ws` with a fallback chain: direct `require.resolve("ws")` first, then searching the pnpm store via `find`. No manual path configuration needed.

If auto-resolution fails, the error message tells you exactly what to run. Use `.cjs` extension (not `.mjs`) to avoid ESM resolution issues.

## 3. Chrome DevTools MCP Cannot Debug Node.js

The `mcp__plugin_chrome-devtools-mcp_*` tools only operate on browser pages:

- `list_pages` only returns browser tabs
- `evaluate_script` runs in the browser page context, not Node.js
- `navigate_page` to `chrome://inspect` can see the target but can't interact with the DevTools window it opens
- Browser pages can't `fetch()` or WebSocket-connect to `localhost:9229` (CORS/security)

**Conclusion:** Use the CDP agent script for Node.js debugging, not Chrome DevTools MCP.

## 4. `debugger` Statements in Source Code

Adding `debugger;` to source files works when a debugger is attached, but:

- Requires rebuilding (webpack watch mode may or may not pick up lib changes)
- Clutters source code
- Must be removed before committing
- Breakpoints via CDP are cleaner and don't modify code

## 5. Breakpoints in Async/Callback Code

When code is dispatched through RabbitMQ or setTimeout, the consumer callback runs in a different tick. A breakpoint set on the handler function may not fire if the search matched the class definition rather than the compiled callback wrapper.

**Fix:** Search for a string unique to the callback body, not the function declaration.

## 6. Server Crashes on EADDRINUSE

If the previous server didn't shut down cleanly, port 3001 is still in use.

```bash
# Kill everything on the relevant ports
lsof -ti:3001 | xargs kill
lsof -ti:9229 | xargs kill
```

## 7. Inspector HTTP Endpoint Disappears

`http://localhost:9229/json` stops responding after a WebSocket client connects. The HTTP server shuts down.

**Fix:** Always fetch the WebSocket URL immediately on startup, before any client connects. The agent's polling loop does this automatically.
