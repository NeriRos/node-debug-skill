# Setting Breakpoints in Webpack-Bundled Code

## The Problem

Webpack compiles all source files into a single `main.js` bundle. When you use `Debugger.setBreakpointByUrl` with a URL regex like `stripeWebhookHandler\.ts`, it sets a **pending** breakpoint that never resolves — because V8 never loads a script with that URL. The source-mapped filenames exist only in the source map, not as real scripts.

## The Solution

Search the compiled `main.js` for your function's text, then set breakpoints by `scriptId` + `lineNumber`.

### Step-by-step:

1. **Enable debugger** — triggers `Debugger.scriptParsed` for every loaded script
2. **Find `main.js`** — look for a script whose URL contains `main.js`
3. **Get source** — `Debugger.getScriptSource({ scriptId })` returns the full bundle (~200K+ lines)
4. **Search** — find the line containing your function signature
5. **Set breakpoint** — `Debugger.setBreakpoint({ location: { scriptId, lineNumber } })`

### Choosing search strings

Good (unique signatures):
```
"async dispatch(event)"
"async handle(event)"
"hasFinancialAccount(event)"
"class StripeWebhookCoordinator"
```

Bad (too common, matches many lines):
```
"async"
"return false"
"if ("
```

If your search string matches multiple lines, the agent uses the first match. To be more precise, include surrounding context or use a longer unique string.

## Non-webpack Alternative

If the server runs with `ts-node`, `tsx`, or plain `node` (no bundler), each source file loads as its own V8 script. In that case, `setBreakpointByUrl` with `urlRegex` works perfectly:

```javascript
await send("Debugger.setBreakpointByUrl", {
  urlRegex: "stripeWebhookHandler\\.ts$",
  lineNumber: 68,  // 0-indexed
  columnNumber: 0,
});
```

No need to search the source.
