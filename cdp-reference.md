# CDP (Chrome DevTools Protocol) Reference

## Debugger Domain

### Methods

| Method | Params | Purpose |
|--------|--------|---------|
| `Debugger.enable` | — | Activate debugger; triggers `scriptParsed` for all loaded scripts |
| `Debugger.disable` | — | Deactivate debugger |
| `Debugger.setBreakpoint` | `{ location: { scriptId, lineNumber, columnNumber } }` | Set BP by exact location — **use for webpack bundles** |
| `Debugger.setBreakpointByUrl` | `{ urlRegex, lineNumber, columnNumber }` | Set BP by URL pattern — **use for non-webpack (ts-node, tsx)** |
| `Debugger.removeBreakpoint` | `{ breakpointId }` | Remove a breakpoint |
| `Debugger.resume` | — | Continue execution |
| `Debugger.stepOver` | — | Step to next line (skip function internals) |
| `Debugger.stepInto` | — | Step into function call |
| `Debugger.stepOut` | — | Run until current function returns |
| `Debugger.pause` | — | Force-pause execution immediately |
| `Debugger.evaluateOnCallFrame` | `{ callFrameId, expression, returnByValue }` | Eval expression in paused frame context |
| `Debugger.getScriptSource` | `{ scriptId }` | Get full source text of a loaded script |
| `Debugger.searchInContent` | `{ scriptId, query }` | Search within a script's source |
| `Debugger.setPauseOnExceptions` | `{ state: "none" \| "uncaught" \| "all" }` | Pause on exceptions |
| `Debugger.setAsyncCallStackDepth` | `{ maxDepth }` | Set async stack trace depth |

### Events

| Event | Payload | When |
|-------|---------|------|
| `Debugger.scriptParsed` | `{ scriptId, url, sourceMapURL, startLine, endLine }` | A script was loaded by V8 |
| `Debugger.paused` | `{ callFrames, reason, hitBreakpoints }` | Execution paused |
| `Debugger.resumed` | — | Execution resumed |

### Call Frame Structure (in `Debugger.paused`)

```json
{
  "callFrameId": "...",
  "functionName": "dispatch",
  "location": { "scriptId": "2123", "lineNumber": 225837, "columnNumber": 0 },
  "url": "file:///path/to/main.js",
  "scopeChain": [
    { "type": "local", "object": { "objectId": "..." } },
    { "type": "closure", "object": { "objectId": "..." } },
    { "type": "global", "object": { "objectId": "..." } }
  ]
}
```

## Runtime Domain

### Methods

| Method | Params | Purpose |
|--------|--------|---------|
| `Runtime.enable` | — | Enable runtime events |
| `Runtime.getProperties` | `{ objectId, ownProperties, generatePreview }` | Get object properties (for inspecting locals) |
| `Runtime.evaluate` | `{ expression, returnByValue }` | Eval in global scope (not in paused frame) |

### Using `getProperties` for Variable Inspection

When a frame is paused, each scope in `scopeChain` has an `objectId`. Use `Runtime.getProperties` to enumerate variables:

```javascript
const r = await send("Runtime.getProperties", {
  objectId: scope.object.objectId,
  ownProperties: true,
  generatePreview: true,  // gives short previews of objects
});
// r.result.result = [{ name: "event", value: { type: "object", preview: {...} } }, ...]
```

## Useful Patterns

### Pause on uncaught exceptions
```javascript
await send("Debugger.setPauseOnExceptions", { state: "uncaught" });
```

### Conditional breakpoint (via eval after hitting BP)
Set a normal breakpoint, then in the pause handler check a condition and auto-resume if not met.

### Watch expressions
After pausing, evaluate multiple expressions and include results in the state file.
