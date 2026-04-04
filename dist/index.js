/**
 * openclaw-exec-truncate — Domain-aware output truncation for exec tool
 *
 * Hook: tool_result_persist
 * Compresses git diff/log, grep, ls, and build output — 20-40% token savings.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------
const MARKER = (n) => `  ... [${n} lines truncated by exec-truncate] ...`;
// ---------------------------------------------------------------------------
// Domain-specific truncation
// ---------------------------------------------------------------------------
/** git diff: head + tail additions, preserve original when everything fits */
function truncateGitDiff(text, head, tail) {
    const lines = text.split("\n");
    const additions = lines.filter((l) => l.startsWith("+"));
    if (additions.length === 0)
        return text;
    // If additions fit entirely within head+tail, return original (preserves context)
    if (additions.length <= head + tail)
        return text;
    const kept = additions.slice(0, head);
    const omitted = additions.length - head - tail;
    const tailAdditions = additions.slice(-tail);
    return [...kept, MARKER(omitted), ...tailAdditions].join("\n");
}
/** git log: one line per commit — hash | subject */
function truncateGitLog(text, max) {
    const lines = text.split("\n");
    // Single-pass: collect commit header lines
    const commitLines = [];
    for (const line of lines) {
        if (/^[0-9a-f]{7,40} /.test(line))
            commitLines.push(line);
    }
    if (commitLines.length === 0)
        return text;
    if (commitLines.length <= max)
        return text;
    const kept = commitLines.slice(0, max);
    const output = kept.map((line) => {
        const hashMatch = line.match(/^([0-9a-f]{7,40})(\s+)(.*)/);
        return hashMatch
            ? `${hashMatch[1].slice(0, 7)} | ${hashMatch[3].trim()}`
            : line;
    });
    const omitted = commitLines.length - max;
    output.push(MARKER(omitted));
    return output.join("\n");
}
/** grep: strip absolute paths, keep filename:line:col */
function truncateGrep(text, max) {
    const lines = text.split("\n");
    const output = [];
    const seen = new Set();
    for (const line of lines) {
        if (output.length >= max)
            break;
        if (!line.trim())
            continue;
        const stripped = line.replace(/^\/.+?\/([^/]+:\d+)/, "$1");
        if (seen.has(stripped))
            continue; // deduplicate
        seen.add(stripped);
        output.push(stripped);
    }
    const total = lines.filter((l) => l.trim()).length;
    const omitted = total - output.length;
    if (omitted > 0)
        output.push(MARKER(omitted));
    return output.join("\n");
}
/** ls: strip perms/owner/group/time, abbreviate size */
function truncateLs(text, max) {
    const lines = text.split("\n");
    const output = [];
    for (const line of lines) {
        if (output.length >= max)
            break;
        if (!line.trim() || line.includes("total "))
            continue;
        const match = line.match(/^([dl\-bcs])[rwx\-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w+\s+\d+\s+[\d:]+\s+(.+)$/);
        if (match) {
            const [, type, size, name] = match;
            const icon = type === "d" ? "📁" : "📄";
            const abbrev = abbrevSize(parseInt(size, 10) || 0);
            output.push(`${icon}  ${abbrev}  ${name}`);
        }
        else {
            output.push(line);
        }
    }
    const total = lines.filter((l) => l.trim() && !l.includes("total ")).length;
    if (output.length < total)
        output.push(MARKER(total - output.length));
    return output.join("\n");
}
function abbrevSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}K`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}M`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}
/** build output: strip ANSI, progress bars, keep errors/warnings */
function truncateBuild(text, head, tail) {
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const clean = (s) => stripAnsi(s.replace(/\r.+$/gm, ""));
    const isProgress = (s) => /^[\s]*[═▓░█●○■□◉◌]+\s*\d+%/m.test(s) || /^[\s]*\r$/.test(s);
    const isImportant = (s) => /\b(error|Error|ERROR|fail|Fail|FAIL|warning|Warning|WARN|warn)\b/i.test(s) ||
        /^(\.\/|\/|[a-z]:)/i.test(s.split(":")[0] ?? "");
    const cleanLines = clean(text).split("\n");
    const headLines = [];
    const tailLines = [];
    const seenTail = new Set();
    for (const line of cleanLines) {
        if (!isProgress(line) && (isImportant(line) || headLines.length < 3)) {
            headLines.push(line.trim());
        }
    }
    // Tail: only important lines NOT already in head, deduped
    for (const line of cleanLines) {
        if (isImportant(line)) {
            const trimmed = line.trim();
            if (!seenTail.has(trimmed)) {
                seenTail.add(trimmed);
                tailLines.push(trimmed);
            }
        }
    }
    const kept = headLines.slice(0, head);
    const tailChunk = tailLines.slice(-tail);
    return [...kept, "", ...tailChunk].join("\n");
}
// ---------------------------------------------------------------------------
// Apply truncation based on detected domain
// ---------------------------------------------------------------------------
function applyTruncation(output, domain, config) {
    switch (domain) {
        case "gitDiff": {
            if (config.gitDiff?.enabled === false)
                return output;
            return truncateGitDiff(output, config.gitDiff?.headLines ?? 80, config.gitDiff?.tailLines ?? 20);
        }
        case "gitLog": {
            if (config.gitLog?.enabled === false)
                return output;
            return truncateGitLog(output, config.gitLog?.maxLines ?? 50);
        }
        case "grep": {
            if (config.grep?.enabled === false)
                return output;
            return truncateGrep(output, config.grep?.maxMatches ?? 50);
        }
        case "ls": {
            if (config.ls?.enabled === false)
                return output;
            return truncateLs(output, config.ls?.maxEntries ?? 100);
        }
        case "build": {
            if (config.build?.enabled === false)
                return output;
            return truncateBuild(output, config.build?.headLines ?? 10, config.build?.tailLines ?? 30);
        }
        default:
            return output;
    }
}
// ---------------------------------------------------------------------------
// Domain detection (output-pattern based — command-based via Chunk 2)
// ---------------------------------------------------------------------------
function detectDomain(text) {
    if (/^diff --git/m.test(text) || /^index [0-9a-f]{7}/m.test(text))
        return "gitDiff";
    if (/^[0-9a-f]{7,40} /.test(text) && /Author:|commit /m.test(text))
        return "gitLog";
    if (/^[^:\n]+:\d+:\d*:/m.test(text))
        return "grep";
    if (/^[dl\-bcs][rwx\-]{9}\s+\d+\s+\S+/m.test(text))
        return "ls";
    if (/\b(error|Error|ERROR|warning|Warning|WARN|failed|FAILED|compil)/m.test(text))
        return "build";
    return null;
}
// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default definePluginEntry({
    id: "exec-truncate",
    name: "exec-truncate",
    description: "Domain-aware output truncation for exec tool",
    register: (api) => {
        const config = 
        // @ts-ignore — pluginConfig optional on OpenClawPluginApi but present at runtime
        api.pluginConfig ?? {};
        // @ts-ignore — registerHook not in core.d.ts stubs
        api.registerHook("tool_result_persist", (event) => {
            const { toolName, message } = event;
            if (toolName !== "exec" && toolName !== "bash")
                return message;
            if (config.enabled === false)
                return message;
            const rawContent = message.content;
            const content = typeof rawContent === "string"
                ? rawContent
                : Array.isArray(rawContent)
                    ? rawContent
                        .filter((p) => p.type === "text" && typeof p.text === "string")
                        .map((p) => p.text)
                        .join("\n")
                    : "";
            if (!content || content.length < 200)
                return message;
            const domain = detectDomain(content);
            if (!domain)
                return message;
            const truncated = applyTruncation(content, domain, config);
            if (truncated === content)
                return message;
            if (typeof message.content === "string") {
                message.content = truncated;
            }
            else if (Array.isArray(message.content)) {
                const parts = message.content;
                const first = parts.find((p) => p.type === "text" && typeof p.text === "string");
                if (first)
                    first.text = truncated;
            }
            return message;
        });
    },
});
