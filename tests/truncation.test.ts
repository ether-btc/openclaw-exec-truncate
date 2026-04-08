import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// MARKER — must match src/index.ts exactly
// ---------------------------------------------------------------------------

const MARKER = (n: number) =>
  `  ... [${n} ${n === 1 ? "line" : "lines"} truncated by exec-truncate] ...`;

// ---------------------------------------------------------------------------
// Local function copies — MUST match src/index.ts exactly
// ---------------------------------------------------------------------------

function truncateGitDiff(text: string, head: number, tail: number): string {
  const lines = text.split("\n");
  const additions = lines.filter((l) => l.startsWith("+"));
  if (additions.length === 0) return text;
  if (additions.length <= head + tail) return text; // ← fix #1: return original
  const kept = additions.slice(0, head);
  const omitted = additions.length - head - tail;
  const tailAdditions = additions.slice(-tail);
  return [...kept, MARKER(omitted), ...tailAdditions].join("\n");
}

function truncateGitLog(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let commitLines: string[] = [];

  const flush = () => {
    if (commitLines.length === 0) return;
    const subject = commitLines.find((l) => l.trim().length > 0) ?? "";
    const hashMatch = subject.match(/^([0-9a-f]{7,40})(?:\s+)(.*)/);
    if (!hashMatch) {
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
  return [...kept, MARKER(omitted)].join("\n");
}

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
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    output.push(stripped);
  }

  const omitted = total - output.length;
  if (omitted > 0) output.push(MARKER(omitted));

  return output.join("\n");
}

function abbrevSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

function truncateLs(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.includes("total ")) continue;
    if (output.length < max) {
      const match = line.match(
        /^([dl\-bcs])[rwx\-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w+\s+\d+\s+[\d:]+\s+(.+)$/,
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
  if (output.length < total) output.push(MARKER(total - output.length));

  return output.join("\n");
}

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

  for (const line of cleanLines) {
    if (!isProgress(line) && !isImportant(line) && headLines.length < head) {
      const trimmed = line.trim();
      headLines.push(trimmed);
      seenHead.add(trimmed);
    }
  }

  for (const line of cleanLines) {
    if (isImportant(line)) {
      const trimmed = line.trim();
      if (!seenHead.has(trimmed) && !seenTail.has(trimmed)) {
        seenTail.add(trimmed);
        tailLines.push(trimmed);
      }
    }
  }

  const kept = headLines.slice(0, head);
  const tailChunk = tailLines.slice(-tail);
  return [...kept, "", ...tailChunk].join("\n");
}

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
// Tests: git diff
// ---------------------------------------------------------------------------

describe("truncateGitDiff", () => {
  it("returns unchanged when no additions", () => {
    expect(truncateGitDiff("foo\nbar", 10, 5)).toBe("foo\nbar");
  });

  it("returns original when additions fit within head+tail", () => {
    // fix #1: must return original text (preserves context lines), not additions.join
    expect(truncateGitDiff("+foo\n+bar\n+baz", 10, 5)).toBe("+foo\n+bar\n+baz");
    expect(truncateGitDiff("+one\n+two", 10, 2)).toBe("+one\n+two");
  });

  it("truncates middle with marker", () => {
    // 10 additions, head=3, tail=2 → omitted=5
    const input = Array.from({ length: 10 }, (_, i) => `+line${i}`).join("\n");
    const result = truncateGitDiff(input, 3, 2);
    expect(result).toContain("+line0");
    expect(result).toContain(MARKER(5));
    expect(result).toContain("+line9");
    expect(result).not.toContain("+line3"); // truncated
  });

  it("marker shows correct omission count", () => {
    // 12 additions, head=5, tail=3 → omitted=4
    const input = Array.from({ length: 12 }, (_, i) => `+line${i}`).join("\n");
    expect(truncateGitDiff(input, 5, 3)).toContain(MARKER(4));
  });
});

// ---------------------------------------------------------------------------
// Tests: git log
// ---------------------------------------------------------------------------

describe("truncateGitLog", () => {
  it("condenses commit: hash | message", () => {
    const input = "abc1234567890 fix: resolve bug in auth\nAuthor: Test <t@t.com>";
    const result = truncateGitLog(input, 10);
    expect(result).toMatch(/abc1234 \| fix: resolve bug in auth/);
    expect(result).not.toContain("Author:");
  });

  it("respects max commits", () => {
    const input = [
      "1111111111111111111111111111111111111111 commit 0",
      "2222222222222222222222222222222222222222 commit 1",
      "3333333333333333333333333333333333333333 commit 2",
      "4444444444444444444444444444444444444444 commit 3",
      "5555555555555555555555555555555555555555 commit 4",
    ].join("\n");
    const result = truncateGitLog(input, 3);
    const commits = result.split("\n").filter((l) => l.includes("commit"));
    expect(commits.length).toBe(3);
    expect(result).toContain(MARKER(2));
  });

  it("skips empty input", () => {
    expect(truncateGitLog("", 10)).toBe("");
  });

  it("returns original text when no commits detected", () => {
    const input = "no commits here\njust some text";
    expect(truncateGitLog(input, 10)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Tests: grep
// ---------------------------------------------------------------------------

describe("truncateGrep", () => {
  it("strips absolute paths", () => {
    const result = truncateGrep("/foo/bar/baz/src/utils.ts:42:const x = 1", 10);
    expect(result).toBe("utils.ts:42:const x = 1");
  });

  it("deduplicates identical lines", () => {
    const result = truncateGrep(
      "/foo/file.ts:1:same\n/bar/file.ts:1:same\n/baz.ts:3:diff",
      10,
    );
    const lines = result.split("\n").filter((l) => l.includes("same"));
    expect(lines.length).toBe(1);
  });

  it("respects max lines including marker", () => {
    // 10 unique lines, max=5 → 5 results + 1 marker = 6 lines total
    const input = Array.from(
      { length: 10 },
      (_, i) => `file${i}.ts:1:line ${i}`,
    ).join("\n");
    const result = truncateGrep(input, 5);
    const allLines = result.split("\n").filter((l) => l.trim());
    expect(allLines.length).toBe(6); // 5 results + marker
  });

  it("marker counts original lines (not deduplicated)", () => {
    // 5 unique lines, each duplicated 3x = 15 original lines → omitted = 15 - 5 = 10
    const input = Array.from({ length: 5 }, (_, i) =>
      Array.from({ length: 3 }, () => `file${i}.ts:1:line ${i}`).join("\n"),
    ).join("\n");
    const result = truncateGrep(input, 5);
    expect(result).toContain(MARKER(10)); // 15 original - 5 shown = 10 omitted
    expect(result).not.toContain(MARKER(0));
  });

  it("skips empty input", () => {
    expect(truncateGrep("", 10)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Tests: ls
// ---------------------------------------------------------------------------

describe("truncateLs", () => {
  it("strips perms/owner and shows icon + size + name", () => {
    const result = truncateLs(
      "drwxr-xr-x  12 pi pi 4096 Apr 1 10:00 node_modules",
      10,
    );
    expect(result).toContain("📁");
    expect(result).toContain("node_modules");
    expect(result).not.toContain("drwxr-xr-x");
    expect(result).not.toContain("pi");
  });

  it("shows 📄 for files", () => {
    const result = truncateLs(
      "-rw-r--r--  1 pi pi 12345 Apr 1 10:00 readme.md",
      10,
    );
    expect(result).toContain("📄");
    expect(result).toContain("readme.md");
  });

  it("abbreviates large sizes", () => {
    const result = truncateLs(
      "-rw-r--r--  1 pi pi 1048576 Apr 1 10:00 big.bin",
      10,
    );
    expect(result).toContain("1.0M");
  });

  it("respects max entries", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      `-rw-r--r--  1 pi pi 100 Apr 1 10:00 file${i}.txt`,
    );
    const result = truncateLs(lines.join("\n"), 5);
    const files = result.split("\n").filter((l) => l.includes("file"));
    expect(files.length).toBe(5);
    expect(result).toContain(MARKER(5));
  });
});

// ---------------------------------------------------------------------------
// Tests: build
// ---------------------------------------------------------------------------

describe("truncateBuild", () => {
  it("strips ANSI escape codes", () => {
    const input = "\x1b[32m✓ success\x1b[0m\n\x1b[31m✗ error\x1b[0m";
    const result = truncateBuild(input, 10, 10);
    expect(result).not.toContain("\x1b[");
    expect(result).toContain("success");
    expect(result).toContain("error");
  });

  it("removes progress bars", () => {
    const input = "  ████████████ 100%\n  build output line";
    const result = truncateBuild(input, 10, 10);
    expect(result).not.toContain("████");
    expect(result).not.toContain("100%");
  });

  it("keeps important lines (errors/warnings)", () => {
    const input = "normal output\nERROR: something failed\nmore normal";
    const result = truncateBuild(input, 10, 10);
    expect(result).toContain("ERROR: something failed");
  });

  it("deduplicates head and tail", () => {
    // head=1: first error fills the one head slot, second identical error deduped in tail
    const input = [
      "normal", "normal", "normal",
      "ERROR: duplicate_error",
      "normal", "normal", "normal", "normal", "normal", "normal",
      "ERROR: duplicate_error",
    ].join("\n");
    const result = truncateBuild(input, 1, 10);
    const errorCount = (result.match(/ERROR: duplicate_error/g) || []).length;
    expect(errorCount).toBe(1);
  });

  it("marker appears when tail exceeds limit", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `ERROR: error ${i}`,
    );
    const result = truncateBuild(lines.join("\n"), 5, 5);
    const tailCount = (
      result.split("\n").filter((l) => l.startsWith("ERROR:")).length
    );
    expect(tailCount).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: detectDomain
// ---------------------------------------------------------------------------

describe("detectDomain", () => {
  it("detects gitDiff from 'diff --git'", () => {
    expect(detectDomain("diff --git a/foo.js b/foo.js")).toBe("gitDiff");
  });

  it("detects gitDiff from 'index [hash]'", () => {
    expect(detectDomain("index 8eba6c8..4dcaf61 100644")).toBe("gitDiff");
  });

  it("detects gitLog from hash + Author:", () => {
    const input =
      "abc1234567890123456789012345678901234a Author: Test <t@t.com>\ncommit msg";
    expect(detectDomain(input)).toBe("gitLog");
  });

  it("detects gitLog from hash + commit keyword", () => {
    expect(detectDomain("abc1234 commit message")).toBe("gitLog");
    // Without Author: or commit — not gitLog
    expect(detectDomain("abc1234 only a hash")).not.toBe("gitLog");
  });

  it("detects grep from 'file:line:' pattern", () => {
    expect(detectDomain("src/foo.ts:42: const x = 1")).toBe("grep");
    expect(detectDomain("bar.ts:10:5: match")).toBe("grep");
  });

  it("detects ls from permission string", () => {
    expect(detectDomain("drwxr-xr-x  12 pi pi 4096 Apr 1 10:00 node_modules")).toBe(
      "ls",
    );
    expect(detectDomain("-rw-r--r--  1 pi pi 123 Apr 1 10:00 readme.md")).toBe("ls");
  });

  it("detects build from error/warning keywords", () => {
    expect(detectDomain("ERROR: build failed")).toBe("build");
    expect(detectDomain("warning: deprecated API")).toBe("build");
    expect(detectDomain("compilation failed")).toBe("build");
    expect(detectDomain("BUILD FAILED")).toBe("build");
  });

  it("returns null for unknown content", () => {
    expect(detectDomain("hello world")).toBeNull();
    expect(detectDomain("")).toBeNull();
    expect(detectDomain("just some random text")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: MARKER format
// ---------------------------------------------------------------------------

describe("MARKER format", () => {
  it("includes exec-truncate label and count", () => {
    const m = MARKER(5);
    expect(m).toContain("exec-truncate");
    expect(m).toContain("5");
    expect(m).toContain("lines"); // plural
  });

  it("uses singular 'line' for n=1", () => {
    const m = MARKER(1);
    expect(m).toContain("1 line");
    expect(m).not.toContain("1 lines");
  });

  it("uses plural 'lines' for n>1", () => {
    const m = MARKER(0);
    expect(m).toContain("0 lines");
    const m2 = MARKER(99);
    expect(m2).toContain("99 lines");
  });
});

// ---------------------------------------------------------------------------
// Tests: abbrevSize
// ---------------------------------------------------------------------------

describe("abbrevSize", () => {
  it("bytes below 1KB", () => {
    expect(abbrevSize(0)).toBe("0B");
    expect(abbrevSize(1023)).toBe("1023B");
  });

  it("kilobytes at exactly 1KB boundary", () => {
    expect(abbrevSize(1024)).toBe("1.0K");
  });

  it("kilobytes above 1KB", () => {
    expect(abbrevSize(1025)).toBe("1.0K");
    expect(abbrevSize(1536)).toBe("1.5K");
  });

  it("megabytes at exactly 1MB boundary", () => {
    expect(abbrevSize(1048576)).toBe("1.0M");
  });

  it("megabytes above 1MB", () => {
    expect(abbrevSize(1572864)).toBe("1.5M");
  });

  it("gigabytes", () => {
    expect(abbrevSize(1073741824)).toBe("1.0G");
    expect(abbrevSize(2147483648)).toBe("2.0G");
  });
});
