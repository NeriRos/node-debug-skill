# Setting Breakpoints in Webpack-Bundled Code

## The Problem

Webpack compiles all source files into a single `main.js` bundle. When you use `Debugger.setBreakpointByUrl` with a URL regex like `stripeWebhookHandler\.ts`, it sets a **pending** breakpoint that never resolves — because V8 never loads a script with that URL. The source-mapped filenames exist only in the source map, not as real scripts.

## The Solution

Search the compiled `main.js` for your function's text, then set breakpoints by `scriptId` + `lineNumber`.

### Step-by-step:

1. **Enable debugger** — triggers `Debugger.scriptParsed` for every loaded script
2. **Find `main.js`** — look for a script whose URL contains `main.js`
3. **Search** — `Debugger.searchInContent({ scriptId, query })` does a server-side search without transferring the full bundle
4. **Set breakpoint** — `Debugger.setBreakpoint({ location: { scriptId, lineNumber } })`

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

## How to Pick Breakpoint Search Strings

Before creating the agent, read the source files for the flow you're debugging.
For each function you want to break on:

1. Open the source file and find the function
2. Look for a **unique line** inside or at the start of the function body
3. Prefer:
   - Method signatures with unique names: `async dispatch(event)`
   - Domain-specific string literals: `source_flow_type === "payout"`
   - Unique method calls: `getBalanceTransactionIds`
4. Avoid:
   - Generic patterns: `async`, `return`, `if (`
   - Import statements (compiled away by webpack)
   - Type annotations (stripped by TypeScript)

Test uniqueness: if the string appears in multiple functions, add more context.

## Non-webpack Alternative

If the server runs with `ts-node`, `tsx`, or plain `node` (no bundler), each source file loads as its own V8 script. In that case, `setBreakpointByUrl` with `urlRegex` works perfectly:

```javascript
await send("Debugger.setBreakpointByUrl", {
  urlRegex: "stripeWebhookHandler\\.ts$",
  lineNumber: 68, // 0-indexed
  columnNumber: 0,
});
```

No need to search the source.
