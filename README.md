# exec-truncate

**Domain-aware output truncation for the OpenClaw `exec` tool.**

Installs as an OpenClaw plugin. Intercepts `exec` / `bash` output, detects the command domain from output patterns, and compresses verbose output — git diffs, logs, grep results, directory listings, and build logs — down to their informative core.

```
# before
+import { defineConfig } from 'vite'                 # 2,847 lines of diff
+import { defineConfig } from 'vite'
...
+export default defineConfig({                       # +2,840 more lines
# after
+import { defineConfig } from 'vite'
  ... [2845 lines truncated by exec-truncate] ...
+export default defineConfig({
```

**Token savings:** 20–40% on typical git/build/grep output.

---

## Supported Domains

| Domain | Detects | What it does |
|--------|---------|-------------|
| `gitDiff` | `diff --git`, `index [hash]` | Additions-only head+tail; skips unchanged context lines |
| `gitLog` | 40-char hash + `Author:` | One line per commit: `hash7 \| subject` |
| `grep` | `file:line:col` | Strips absolute paths; deduplicates identical matches |
| `ls` | `drwxr-xr-x` perms format | Icon + abbreviated size + name; strips perms/owner/time |
| `build` | `error`, `Error`, `warning` keywords | Strips ANSI, progress bars; keeps errors and warnings |

## Installation

```bash
openclaw plugins install exec-truncate
openclaw gateway restart
```

Or add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": [
      { "module": "exec-truncate" }
    ]
  }
}
```

## Configuration

Defaults work out of the box. Override per domain in `openclaw.json`:

```json
{
  "plugins": {
    "entries": [
      { "module": "exec-truncate" }
    ]
  },
  "skills": {
    "entries": {
      "exec-truncate": {
        "config": {
          "enabled": true,
          "gitDiff": { "headLines": 80, "tailLines": 20 },
          "gitLog": { "maxLines": 50 },
          "grep": { "maxMatches": 50 },
          "ls": { "maxEntries": 100 },
          "build": { "headLines": 10, "tailLines": 30 }
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Master kill switch |
| `gitDiff.headLines` | `80` | Addition lines to keep at start |
| `gitDiff.tailLines` | `20` | Addition lines to keep at end |
| `gitLog.maxLines` | `50` | Max commit summary lines |
| `grep.maxMatches` | `50` | Max grep result lines |
| `ls.maxEntries` | `100` | Max directory entry lines |
| `build.headLines` | `10` | Build output lines to keep at start |
| `build.tailLines` | `30` | Error/warning lines to keep at end |

## Behavior

- **Small outputs pass through unchanged.** Outputs under 200 characters are not truncated.
- **Detection is output-based**, not command-based. The plugin reads the output content and identifies the domain from patterns — no command metadata required.
- **The `MARKER`** — `... [N lines truncated by exec-truncate] ...` — appears whenever lines are omitted, so you always know truncation happened.
- **All domains can be disabled individually** via `domain.enabled: false`.

## Testing

```bash
npm install
npm test        # 25 tests — truncation functions + hook integration
```

## Architecture

```
tool_result_persist (synchronous hook)
  └── message.content
        ├── string → used directly
        └── array  → text parts joined, filtered to type:"text"
              ├── < 200 chars → returned unchanged
              ├── domain detected? → apply domain truncation
              └── no domain → returned unchanged
```

## Changelog

- **1.0.0** — Initial release. 5 domains: gitDiff, gitLog, grep, ls, build.

---

Built with [OpenClaw Plugin SDK](https://docs.openclaw.ai/plugins/).
