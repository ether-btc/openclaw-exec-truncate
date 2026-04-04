import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Local function copies — MUST match src/index.ts exactly
// ---------------------------------------------------------------------------

const MARKER = (n: number) => `  ... [${n} lines truncated by exec-truncate] ...`;

function truncateGitDiff(text: string, head: number, tail: number): string {
  const lines = text.split("\n");
  const additions = lines.filter((l) => l.startsWith("+"));
  if (additions.length === 0) return text;
  if (additions.length <= head + tail) return additions.join("\n");
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
    const summary = commitLines.find((l) => l.trim().length > 0) ?? "";
    const hashMatch = summary.match(/^([0-9a-f]{7,40})(\s+)(.*)/);
    if (!hashMatch) { commitLines = []; return; }
    const hash7 = hashMatch[1].slice(0, 7);
    const msg = hashMatch[3].trim();
    output.push(`${hash7} | ${msg}`);
    commitLines = [];
  };

  for (const line of lines) {
    if (/^[0-9a-f]{7,40} /.test(line)) { flush(); }
    if (output.length >= max) break;
    commitLines.push(line);
  }
  flush();

  const totalCommits = lines.filter((l) => /^[0-9a-f]{7,40} /.test(l)).length;
  const omitted = totalCommits - output.length;
  if (omitted > 0) output.push(MARKER(omitted));

  return output.join("\n");
}

function truncateGrep(text: string, max: number): string {
  const lines = text.split("\n");
  const output: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (output.length >= max) break;
    if (!line.trim()) continue;
    const stripped = line.replace(/^\/.+?\/([^/]+:\d+)/, "$1");
    if (seen.has(stripped)) continue; // deduplicate
    seen.add(stripped);
    output.push(stripped);
  }

  const total = lines.filter((l) => l.trim()).length;
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
    if (output.length >= max) break;
    if (!line.trim() || line.includes("total ")) continue;
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

  const total = lines.filter((l) => l.trim() && !l.includes("total ")).length;
  if (output.length < total) output.push(MARKER(total - output.length));

  return output.join("\n");
}

// ---------------------------------------------------------------------------
// Tests: git diff
// ---------------------------------------------------------------------------

describe("truncateGitDiff", () => {
  it("returns unchanged when no additions", () => {
    expect(truncateGitDiff("foo\nbar", 10, 5)).toBe("foo\nbar");
  });

  it("returns all additions when count fits in head+tail", () => {
    expect(truncateGitDiff("+foo\n+bar\n+baz", 10, 5)).toBe("+foo\n+bar\n+baz");
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

  it("returns unchanged when additions <= head+tail", () => {
    expect(truncateGitDiff("+one\n+two", 10, 2)).toBe("+one\n+two");
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
    // hash must have space after it to match /^[0-9a-f]{7,40} /
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
    const result = truncateGrep("/foo/file.ts:1:same\n/bar/file.ts:1:same\n/baz.ts:3:diff", 10);
    const lines = result.split("\n").filter((l) => l.includes("same"));
    expect(lines.length).toBe(1);
  });

  it("respects max lines including marker", () => {
    // 10 unique lines, max=5 → 5 results + 1 marker = 6 lines total
    const input = Array.from({ length: 10 }, (_, i) => `file${i}.ts:1:line ${i}`).join("\n");
    const result = truncateGrep(input, 5);
    const allLines = result.split("\n").filter((l) => l.trim());
    expect(allLines.length).toBe(6); // 5 results + marker
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
    const result = truncateLs("drwxr-xr-x  12 pi pi 4096 Apr 1 10:00 node_modules", 10);
    expect(result).toContain("📁");
    expect(result).toContain("node_modules");
    expect(result).not.toContain("drwxr-xr-x");
    expect(result).not.toContain("pi");
  });

  it("shows 📄 for files", () => {
    const result = truncateLs("-rw-r--r--  1 pi pi 12345 Apr 1 10:00 readme.md", 10);
    expect(result).toContain("📄");
    expect(result).toContain("readme.md");
  });

  it("abbreviates large sizes", () => {
    const result = truncateLs("-rw-r--r--  1 pi pi 1048576 Apr 1 10:00 big.bin", 10);
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
// Tests: MARKER format
// ---------------------------------------------------------------------------

describe("MARKER format", () => {
  it("includes exec-truncate label and count", () => {
    const m = MARKER(5);
    expect(m).toContain("exec-truncate");
    expect(m).toContain("5");
  });
});
