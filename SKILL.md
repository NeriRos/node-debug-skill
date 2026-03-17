---
name: node-debug
description: Debug a running Node.js process via CDP (Chrome DevTools Protocol). Set breakpoints, step through code, inspect variables, and evaluate expressions — all headless, no GUI needed.
user_invocable: true
arguments:
  - name: action
    description: "Action to perform: attach, breakpoint, resume, step, eval, status, detach. Defaults to 'attach' if omitted."
    required: false
---

# Node.js CDP Debugger

Debug running Node.js processes headlessly using CDP over WebSocket. No GUI needed.

## How It Works

A background Node.js agent connects to the `--inspect` port (9229), sets breakpoints, captures scope/variables on pause, and accepts commands via file-based IPC.

See these reference files for details:

- `architecture.md` — How the agent works, file-based IPC protocol
- `webpack-breakpoints.md` — Setting breakpoints in webpack-bundled code (critical gotcha)
- `gotchas.md` — Connection exclusivity, pnpm ws resolution, Chrome DevTools MCP limits
- `cdp-reference.md` — CDP methods, events, and Runtime domain reference
- `agent-template.md` — Full copy-paste agent script with customization points
- `troubleshooting.md` — Common problems and fixes

## Quick Start

### 1. Attach to a running server

Ensure server runs with `--inspect` (however the project runs on dev):

```bash
# Generic:
node --inspect=0.0.0.0:9229 app.js &
```

### 2. Create and start the agent

Copy the agent from `agent-template.md` into `.context/cdp-agent.cjs`. Customize the `searches` array with your breakpoint targets.

```bash
node .context/cdp-agent.cjs > .context/debugger.log 2>&1 &
```

### 3. Verify connection

```bash
cat .context/debugger-state.json
```

### 4. Trigger the code path (e.g., send a request)

### 5. Inspect paused state

```bash
cat .context/debugger-state.json
# Shows: call stack, local variables, auto-evaluated expressions
```

### 6. Control execution

```bash
echo "resume"   > .context/debugger-cmd   # continue
echo "stepOver"  > .context/debugger-cmd   # next line
echo "stepInto"  > .context/debugger-cmd   # into function
echo "stepOut"   > .context/debugger-cmd   # out of function
echo "eval:JSON.stringify(myVar)" > .context/debugger-cmd  # evaluate
echo "disable:Handler.handle()" > .context/debugger-cmd   # remove a noisy breakpoint
```

### 7. Read result

```bash
sleep 2 && cat .context/debugger-state.json
```

### 8. Detach

```bash
kill $(pgrep -f cdp-agent.cjs)
rm -f .context/debugger-state.json .context/debugger-cmd
```

## Included Scripts

Ready-to-use scripts in `scripts/`:

| Script                           | Purpose                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdp-webpack-debugger.cjs`       | **Main agent** — connects to inspector, searches webpack bundle for functions, sets breakpoints, captures variables on pause, accepts resume/step/eval commands via file IPC |
| `cdp-set-breakpoints-by-url.cjs` | Sets breakpoints by URL regex (for non-webpack servers like ts-node/tsx). Fire-and-forget — sets BPs and disconnects                                                         |
| `cdp-list-scripts.cjs`           | Lists all scripts loaded by the Node.js process. Useful for finding webhook/stripe-related scripts                                                                           |
| `cdp-find-main.cjs`              | Finds the webpack `main.js` bundle and shows script metadata                                                                                                                 |

### Usage

Copy the script you need to `.context/` and run it:

```bash
cp ~/.claude/skills/node-debug/scripts/cdp-webpack-debugger.cjs .context/cdp-agent.cjs
# Edit the `searches` array, then:
node .context/cdp-agent.cjs > .context/debugger.log 2>&1 &
```

The `ws` package is auto-resolved (direct require, then pnpm store search). No manual path configuration needed.
