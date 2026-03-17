# node-debug-skill

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill for debugging running Node.js processes via CDP (Chrome DevTools Protocol). Set breakpoints, step through code, inspect variables, and evaluate expressions — all headless, no GUI needed.

## How It Works

A background Node.js agent connects to the `--inspect` port (9229), sets breakpoints, captures scope/variables on pause, and accepts commands via file-based IPC.

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│  Debugger Agent  │◄──────────────────►│  Node.js --inspect│
│  (cdp-agent.cjs) │     CDP/JSON       │  (port 9229)     │
└────────┬─────────┘                    └──────────────────┘
         │
    File-based IPC
    ├── debugger-state.json  (agent writes)
    └── debugger-cmd         (you write)
```

## Installation

Add to your Claude Code skills directory:

```bash
# Clone into your skills folder
git clone https://github.com/NeriRos/node-debug-skill.git ~/.claude/skills/node-debug
```

## Quick Start

### 1. Start your server with `--inspect`

```bash
node --inspect=0.0.0.0:9229 app.js &
```

### 2. Copy and start the agent

```bash
cp ~/.claude/skills/node-debug/scripts/cdp-webpack-debugger.cjs .context/cdp-agent.cjs
# Edit the `searches` array with your breakpoint targets, then:
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
```

### 7. Detach

```bash
kill $(pgrep -f cdp-agent.cjs)
rm -f .context/debugger-state.json .context/debugger-cmd
```

## Included Scripts

| Script                           | Purpose                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdp-webpack-debugger.cjs`       | **Main agent** — connects to inspector, searches webpack bundle for functions, sets breakpoints, captures variables on pause, accepts resume/step/eval commands via file IPC |
| `cdp-set-breakpoints-by-url.cjs` | Sets breakpoints by URL regex (for non-webpack servers). Fire-and-forget                                                                                                     |
| `cdp-list-scripts.cjs`           | Lists all scripts loaded by the Node.js process                                                                                                                              |
| `cdp-find-main.cjs`              | Finds the webpack `main.js` bundle and shows script metadata                                                                                                                 |

## Documentation

- [Architecture](architecture.md) — Agent design, file-based IPC protocol
- [Webpack Breakpoints](webpack-breakpoints.md) — Setting breakpoints in webpack-bundled code
- [Gotchas](gotchas.md) — Connection exclusivity, pnpm resolution, Chrome DevTools MCP limits
- [CDP Reference](cdp-reference.md) — CDP methods, events, and Runtime domain reference
- [Agent Template](agent-template.md) — Full copy-paste agent script with customization points
- [Troubleshooting](troubleshooting.md) — Common problems and fixes

## License

MIT
