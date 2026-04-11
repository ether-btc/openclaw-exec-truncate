/**
 * openclaw-exec-truncate — Domain-aware output truncation for exec tool
 *
 * Hook: tool_result_persist
 * Compresses git diff/log, grep, ls, and build output — 20-40% token savings.
 */
// @ts-ignore — openclaw plugin SDK does not export definePluginEntry in its type stubs
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// ---------------------------------------------------------------------------
// Config types (mirrors openclaw.plugin.json configSchema)
// ---------------------------------------------------------------------------

interface GitDiffConfig {
  enabled?: boolean;
  headLines?: number;
  tailLines?: number;
}
interface GitLogConfig {
  enabled?: boolean;
  maxLines?: number;
}
interface GrepConfig {
  enabled?: boolean;
  maxMatches?: number;
}
interface LsConfig {
  enabled?: boolean;
  maxEntries?: number;
}
interface BuildConfig {
  enabled?: boolean;
  headLines?: number;
  tailLines?: number;
}
interface PluginConfig {
  enabled?: boolean;
  gitDiff?: GitDiffConfig;
  gitLog?: GitLogConfig;
  grep?: GrepConfig;
  ls?: LsConfig;
  build?: BuildConfig;
}

// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------

const MARKER = (n: number, domain?: string) =>
  `  ... [${domain ? domain + ": " : ""}${n} ${n === 1 ? "line" : "lines"} truncated by exec-truncate] ...`;

// ---------------------------------------------------------------------------
// Domain-specific truncation
// ---------------------------------------------------------------------------

/** git diff: head + tail additions, preserve original when everything fits */
function truncateGitDiff(text: string, head: number, tail: number): string {
  const lines = text.split("\n");
  const additions = lines.filter((l) => l.startsWith("+"));
  if (additions.length === 0) return text;
  // If additions fit entirely within head+tail, return original (preserves context)
  if (additions.length <= head + tail) return text;
  const kept = additions.slice(0, head);
  const omitted = additions.length - head - tail;
  const tailAdditions = additions.slice(-tail);
  return [...kept, MARKER(omitted, "gitDiff"), ...tailAdditions].join("\n");
}

/** git log: one line per commit — hash | subject */
function truncateGitLog(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let commitLines: string[] = [];

  const flush = () => {
    if (commitLines.length === 0) return;
    // Subject = first non-empty line within the commit block
    const subject =
      commitLines.find((l) => l.trim().length > 0) ?? "";
    const hashMatch = subject.match(/^([0-9a-f]{7,40})(?:\s+)(.*)/);
    if (!hashMatch) {
      // Fallback: preserve what we can
      const fallback = commitLines.find((l) => l.trim().length > 0) ?? "[unparseable commit]";
      output.push(fallback);
      commitLines = [];
      return;
    }
    const hash7 = hashMatch[1].slice(0, 7);
    const msg = hashMatch[2].trim();
    output.push(`${hash7} | ${msg}`);
    commitLines = [];
  };

  for (const line of lines) {
    if (/^[0-9a-f]{7,40} /.test(line)) flush();
    commitLines.push(line);
  }
  flush();

  if (output.length === 0) return text;
  if (output.length <= max) return output.join("\n");

  const kept = output.slice(0, max);
  const omitted = output.length - max;
  return [...kept, MARKER(omitted, "gitLog")].join("\n");
}

/** grep: strip absolute paths, keep filename:line:col */
function truncateGrep(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];
  const seen = new Set<string>();

  let total = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total++;
    if (output.length >= max) continue;
    const stripped = line.replace(/^\/.+?\/([^/]+:\d+)/, "$1");
    if (seen.has(stripped)) continue; // deduplicate
    seen.add(stripped);
    output.push(stripped);
  }

  const omitted = total - output.length;
  if (omitted > 0) output.push(MARKER(omitted, "grep"));

  return output.join("\n");
}

/** ls: strip perms/owner/group/time, abbreviate size */
function truncateLs(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.includes("total ")) continue;
    if (output.length < max) {
      const match = line.match(
        /^([dl\-bcs])[rwx\-]{9}[\t ]+\d+[\t ]+\S+[\t ]+\S+[\t ]+(\d+)[\t ]+\w+[\t ]+\d+[\t:]+[\t ]+(.+)$/,
      );
      if (match) {
        const [, type, size, name] = match;
        const icon = type === "d" ? "📁" : "📄";
        const abbrev = abbrevSize(parseInt(size, 10) || 0);
        output.push(`${icon}  ${abbrev}  ${name}`);
      } else {
        output.push(line);
      }
    }
  }

  const total = lines.filter((l) => l.trim() && !l.includes("total ")).length;
  if (output.length < total) output.push(MARKER(total - output.length, "ls"));

  return output.join("\n");
}

function abbrevSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

/** build output: strip ANSI, progress bars, keep errors/warnings */
function truncateBuild(text: string, head: number, tail: number): string {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const clean = (s: string) => stripAnsi(s.replace(/\r.+$/gm, ""));
  const isProgress = (s: string) =>
    /^[\s]*[═▓░█●○■□◉◌]+\s*\d+%/m.test(s) || /^[\s]*\r$/.test(s);
  const isImportant = (s: string) =>
    /\b(error|Error|ERROR|fail|Fail|FAIL|warning|Warning|WARN|warn)\b/i.test(s) ||
    /^(\.\/|\/|[a-z]:)/i.test(s.split(":")[0] ?? "");

  const cleanLines = clean(text).split("\n");
  const headLines: string[] = [];
  const tailLines: string[] = [];
  const seenHead = new Set<string>();
  const seenTail = new Set<string>();

  // Head: only non-progress, non-important filler lines, up to head slots
  for (const line of cleanLines) {
    if (!isProgress(line) && !isImportant(line) && headLines.length < head) {
      const trimmed = line.trim();
      headLines.push(trimmed);
      seenHead.add(trimmed);
    }
  }

  // Tail: important lines only, deduped against head
  for (const line of cleanLines) {
    if (isImportant(line)) {
      const trimmed = line.trim();
      if (!seenHead.has(trimmed) && !seenTail.has(trimmed)) {
        seenTail.add(trimmed);
        tailLines.push(trimmed);
      }
    }
  }

  const tailChunk = tailLines.slice(-tail);
  // Always show tail chunk; backfill from end of cleanLines if tail is sparse
  if (tailChunk.length < tail && cleanLines.length > 0) {
    const remaining = tail - tailChunk.length;
    const fill = cleanLines.slice(-remaining).reverse();
    for (const line of fill) {
      const trimmed = line.trim();
      if (trimmed && !seenTail.has(trimmed) && !seenHead.has(trimmed)) {
        seenTail.add(trimmed);
        tailChunk.unshift(trimmed);
      }
    }
  }
  return [...headLines, "", ...tailChunk].join("\n");
}

// ---------------------------------------------------------------------------
// Apply truncation based on detected domain
// ---------------------------------------------------------------------------

function applyTruncation(
  output: string,
  domain: string,
  config: PluginConfig,
): string {
  switch (domain) {
    case "gitDiff": {
      if (config.gitDiff?.enabled === false) return output;
      return truncateGitDiff(
        output,
        config.gitDiff?.headLines ?? 80,
        config.gitDiff?.tailLines ?? 20,
      );
    }
    case "gitLog": {
      if (config.gitLog?.enabled === false) return output;
      return truncateGitLog(output, config.gitLog?.maxLines ?? 50);
    }
    case "grep": {
      if (config.grep?.enabled === false) return output;
      return truncateGrep(output, config.grep?.maxMatches ?? 50);
    }
    case "ls": {
      if (config.ls?.enabled === false) return output;
      return truncateLs(output, config.ls?.maxEntries ?? 100);
    }
    case "build": {
      if (config.build?.enabled === false) return output;
      return truncateBuild(
        output,
        config.build?.headLines ?? 10,
        config.build?.tailLines ?? 30,
      );
    }
    default:
      return output;
  }
}

// ---------------------------------------------------------------------------
// Domain detection (output-pattern based — command-based via Chunk 2)
// ---------------------------------------------------------------------------

function detectDomain(text: string): string | null {
  if (/^diff --git/m.test(text) || /^index [0-9a-f]{7}/m.test(text))
    return "gitDiff";
  if (/^[0-9a-f]{7,40} /.test(text) && /Author:|commit /m.test(text))
    return "gitLog";
  if (/^[^:\n]+:\d+:/m.test(text)) return "grep";
  if (/^[dl\-bcs][rwx\-]{9}\s+\d+\s+\S+/m.test(text)) return "ls";
  if (/\b(error|Error|ERROR|warning|Warning|WARN|failed|FAILED|compil)/m.test(text))
    return "build";
  return null;
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export {
  truncateGitDiff,
  truncateGitLog,
  truncateGrep,
  truncateLs,
  truncateBuild,
  detectDomain,
  applyTruncation,
  MARKER,
};
export default definePluginEntry({
  id: "exec-truncate",
  name: "exec-truncate",
  description: "Domain-aware output truncation for exec tool",
  register: (api: any) => {
    const raw = api.pluginConfig as Record<string, unknown> ;
    const config: PluginConfig = {
      enabled: raw?.enabled as boolean ,
      gitDiff: raw?.gitDiff as GitDiffConfig ,
      gitLog: raw?.gitLog as GitLogConfig ,
      grep: raw?.grep as GrepConfig ,
      ls: raw?.ls as LsConfig ,
      build: raw?.build as BuildConfig ,
    };

    // TODO: upstream openclaw plugin SDK types — registerHook not in core.d.ts stubs
    // @ts-ignore
    api.registerHook("tool_result_persist", (event: {
      toolName: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: any;
    }) => {
      const { toolName, message } = event;

      if (toolName !== "exec" && toolName !== "bash") return message;
      if (config.enabled === false) return message;

      const rawContent = message.content;
      const content: string =
        typeof rawContent === "string"
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .filter(
                  (p): p is { type: "text"; text: string } =>
                    p.type === "text" && typeof p.text === "string",
                )
                .map((p) => p.text)
                .join("\n")
            : "";

      if (!content || content.length < 200 || content.length > 10_000_000) return message;

      const domain = detectDomain(content);
      if (!domain) return message;

      const truncated = applyTruncation(content, domain, config);
      if (truncated === content) return message;

      // Return a new message object to avoid mutating the shared event
      if (typeof message.content === "string") {
        return { ...message, content: truncated };
      } else if (Array.isArray(message.content)) {
        const parts = message.content as Array<{ type: string; text?: string }>;
        const firstIdx = parts.findIndex(
          (p): p is { type: "text"; text: string } =>
            p.type === "text" && typeof p.text === "string",
        );
        if (firstIdx >= 0) {
          const newParts = [...parts];
          newParts[firstIdx] = { ...parts[firstIdx], text: truncated };
          return { ...message, content: newParts };
        }
      }
      return message;
    }, { name: "exec-truncate" });
  },
});
