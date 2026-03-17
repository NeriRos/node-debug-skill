# Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ECONNREFUSED` on port 9229 | Server not running with `--inspect`, or another debugger client holds the exclusive connection | Start server with `--inspect`. Kill other clients or restart server. Start CDP agent before Chrome. |
| Breakpoints stay "pending" forever | Webpack bundle — `setBreakpointByUrl` with urlRegex doesn't match compiled scripts | Use `setBreakpoint` with `scriptId` + `lineNumber` from source search (see `webpack-breakpoints.md`) |
| `curl localhost:9229/json` returns empty / refused | Inspector HTTP endpoint closes after a WebSocket client connects | Fetch the WS URL before connecting. Or restart server to reset. |
| `ws` module not found / `ERR_MODULE_NOT_FOUND` | pnpm strict linking prevents resolution from outside `node_modules` | Use `require.resolve("ws", { paths: [...] })` with explicit pnpm store path |
| Breakpoint never fires | Search text didn't match compiled output, or code path wasn't executed | Verify search text exists in bundle. Try a different search string. Confirm the code path is actually hit. |
| Server hangs indefinitely | Debugger paused execution but no client is sending `resume` | Write `resume` to `debugger-cmd`, or kill the agent process |
| `EADDRINUSE` on port 3001 | Previous server didn't shut down cleanly | `lsof -ti:3001 \| xargs kill` |
| Agent connects but no `scriptParsed` events | `Debugger.enable` wasn't called, or scripts already loaded before connection | Ensure `Debugger.enable` is called immediately on connect. The 3-second delay before searching handles late arrivals. |
| Chrome DevTools MCP can't see Node.js target | MCP tools only work with browser pages, not Node.js inspector | Use the CDP agent script instead |
| Multiple breakpoints on same line | `findLineInScript` found duplicates | Use more specific search text, or take only the first match |
| `evaluateOnCallFrame` returns `undefined` | Variable not in scope, or expression has a typo | Check available locals in the frame's scope chain first |
| Agent disconnects unexpectedly | Server restarted (webpack rebuild in watch mode) | The agent auto-exits on close. Restart it after the server comes back up. |
