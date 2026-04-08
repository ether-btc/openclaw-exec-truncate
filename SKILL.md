---
name: exec-truncate
description: Domain-aware output truncation for the OpenClaw exec tool. Compresses git diff/log, grep, ls, and build output — 20-40% token savings on common dev commands. Install as an OpenClaw plugin.
location: ~/.openclaw/workspace/openclaw-exec-truncate
---

# Exec-Truncate Skill

Domain-aware output truncation for the OpenClaw `exec` tool. Installs as an OpenClaw plugin; no configuration needed — works out of the box.

## What It Does

Compresses verbose exec output by detecting the command domain from output patterns:

- **git diff** — First 100 + last 20 addition lines. Strips headers, unchanged context.
- **git log** — One line per commit with short hash and branch. Max 50 entries.
- **grep/rg/find** — Caps at 50 matches, strips absolute paths.
- **ls -la/ls -l** — Max 100 entries, keeps name + abbreviated size only.
- **build tools** — Strips ANSI, progress bars; keeps errors and warnings only.

## Integration

**This is a plugin skill.** The core truncation logic wires to OpenClaw's `tool_result_persist` hook automatically on install. The AI applies manual truncation only when the plugin is unavailable.

## Detection

Output-based detection — the plugin reads the content of exec output and identifies the domain from string patterns. No command metadata parsing required.

**Fail-safe:** Any truncation error returns raw output unchanged.

## See Also

- `README.md` — Full documentation, examples, configuration, architecture
- `openclaw.plugin.json` — Plugin manifest with full configSchema
- `src/index.ts` — Plugin entry point
