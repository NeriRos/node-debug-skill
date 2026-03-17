# Architecture

## Overview

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│  Debugger Agent  │◄──────────────────►│  Node.js --inspect│
│  (cdp-agent.cjs) │     CDP/JSON       │  (port 9229)     │
└────────┬─────────┘                    └──────────────────┘
         │
    File-based IPC
    ├── debugger-state.json  (agent writes)
    └── debugger-cmd         (claude writes)
```

## File-based IPC Protocol

### `debugger-state.json` (agent → claude)

Written by the agent whenever state changes. Claude reads this to understand what's happening.

**States:**

| Status | Meaning |
|--------|---------|
| `waiting_for_inspector` | Polling for `--inspect` port to become available |
| `running` | Connected, breakpoints set, executing normally |
| `paused` | Execution paused at breakpoint/step |
| `stepping` | Transitioning between steps |
| `disconnected` | WebSocket closed |
| `error` | Something went wrong (see `error` field) |

**Paused state fields:**

```json
{
  "status": "paused",
  "reason": "breakpoint",
  "hitBreakpoints": ["4:225836:0:2123"],
  "frames": [
    {
      "functionName": "dispatch",
      "url": "main.js",
      "line": 225838,
      "locals": {
        "event": "{id: evt_123, type: treasury.received_credit.created}",
        "routingKey": "stripe-webhooks.treasury.received_credit.created"
      }
    }
  ],
  "evaluated": {
    "event?.type": "treasury.received_credit.created",
    "event?.id": "evt_123"
  },
  "lastEval": {
    "expression": "JSON.stringify(this.exchange)",
    "result": "\"stripe-webhooks\""
  },
  "timestamp": "2026-03-17T12:05:24.151Z"
}
```

### `debugger-cmd` (claude → agent)

Claude writes a single-line command. Agent reads, deletes the file, and executes.

**Commands:**

| Command | Action |
|---------|--------|
| `resume` | Continue execution (`Debugger.resume`) |
| `stepOver` | Step to next line (`Debugger.stepOver`) |
| `stepInto` | Step into function call (`Debugger.stepInto`) |
| `stepOut` | Step out of current function (`Debugger.stepOut`) |
| `eval:<expr>` | Evaluate expression on top frame, result in `lastEval` |

## Agent Lifecycle

1. **Start**: Agent begins polling `http://127.0.0.1:9229/json` for the inspector
2. **Connect**: Gets WebSocket URL, opens connection
3. **Enable**: Sends `Debugger.enable` + `Runtime.enable`, receives all `scriptParsed` events
4. **Search**: Finds `main.js` scriptId, downloads source, searches for breakpoint targets
5. **Set breakpoints**: Uses `Debugger.setBreakpoint` with scriptId + line number
6. **Wait**: Enters idle state, listening for `Debugger.paused` events
7. **Pause**: On pause, captures call frames, local variables, auto-evals expressions
8. **Command loop**: Polls `debugger-cmd` file every 300ms for instructions
9. **Resume/Step**: Sends CDP command, returns to wait state

## Important: Start Order

The agent MUST connect to the inspector BEFORE Chrome DevTools or `chrome://inspect`. Node.js inspector only allows one WebSocket client. The agent includes a polling loop that waits for the inspector, so you can start it before the server.

```bash
# 1. Start agent first (it polls until inspector is ready)
node .context/cdp-agent.cjs > .context/debugger.log 2>&1 &

# 2. Then start the server
USE_DOCKER=true nx run server:debug-dev --output-style stream &
```
