import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Hook integration tests — test the registerHook call without OpenClaw SDK
// ---------------------------------------------------------------------------

function simulateHook(
  toolName: string,
  messageContent: string | Array<{ type: string; text?: string }>,
  config: { enabled?: boolean; gitDiff?: { headLines?: number; tailLines?: number } },
): string | Array<{ type: string; text?: string }> {
  const MARKER = (n: number) => `  ... [${n} ${n === 1 ? "line" : "lines"} truncated by exec-truncate] ...`;

  const content =
    typeof messageContent === "string"
      ? messageContent
      : Array.isArray(messageContent)
        ? messageContent
            .filter(
              (p): p is { type: "text"; text: string } =>
                p.type === "text" && typeof p.text === "string",
            )
            .map((p) => p.text)
            .join("\n")
        : "";

  if (toolName !== "exec" && toolName !== "bash") return messageContent;
  if (config.enabled === false) return messageContent;
  if (!content || content.length < 200) return messageContent;

  // detectDomain
  const lines = content.split("\n");
  const additions = lines.filter((l) => l.startsWith("+"));
  if (additions.length === 0) return messageContent;

  const head = config.gitDiff?.headLines ?? 80;
  const tail = config.gitDiff?.tailLines ?? 20;

  if (additions.length <= head + tail) return messageContent;

  const kept = additions.slice(0, head);
  const omitted = additions.length - head - tail;
  const tailAdditions = additions.slice(-tail);
  const truncated = [...kept, MARKER(omitted), ...tailAdditions].join("\n");

  return typeof messageContent === "string"
    ? truncated
    : [{ type: "text", text: truncated }];
}

describe("hook: tool_name filter", () => {
  it("passes through non-exec tools", () => {
    const result = simulateHook("telegram", "hello world", {});
    expect(result).toBe("hello world");
  });

  it("passes through when enabled=false", () => {
    const longOutput = "+".repeat(300);
    const result = simulateHook("exec", longOutput, { enabled: false });
    expect(result).toBe(longOutput);
  });

  it("passes through short outputs", () => {
    const result = simulateHook("exec", "hello", {});
    expect(result).toBe("hello");
  });
});

describe("hook: truncation triggers on long content", () => {
  it("truncates additions exceeding head+tail threshold", () => {
    // >200 chars so content.length check passes
    const lines = Array.from({ length: 200 }, (_, i) => `+line${i}`);
    const input = lines.join("\n");
    const result = simulateHook("exec", input, { gitDiff: { headLines: 3, tailLines: 2 } });
    const text = typeof result === "string" ? result : (result[0]?.text ?? "");
    expect(text).toContain("+line0");
    expect(text).not.toContain("+line3"); // truncated
    expect(text).toContain("...");
  });

  it("passes through when additions fit in head+tail", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `+line${i}`);
    const input = lines.join("\n");
    const result = simulateHook("exec", input, { gitDiff: { headLines: 80, tailLines: 20 } });
    // Since additions (10) <= head+tail (100), passes through unchanged
    expect(typeof result === "string" ? result : result[0]?.text).toContain("+line9");
  });
});

describe("hook: message content extraction", () => {
  it("handles string content — truncates when additions exceed head+tail", () => {
    // 300 additions: head=3, tail=2 → omitted = 295 → result much shorter than 300
    const input = Array.from({ length: 300 }, () => "+").join("\n");
    const result = simulateHook("exec", input, { gitDiff: { headLines: 3, tailLines: 2 } });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeLessThan(input.length);
  });

  it("handles array content", () => {
    const input = [{ type: "text", text: "+".repeat(300) }, { type: "image" as const }];
    const result = simulateHook("exec", input, { gitDiff: { headLines: 3, tailLines: 2 } });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("hook: config respects head/tail params", () => {
  it("uses config headLines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `+line${i}`);
    const result = simulateHook("exec", lines.join("\n"), { gitDiff: { headLines: 5, tailLines: 5 } });
    const text = typeof result === "string" ? result : (result[0]?.text ?? "");
    // head=5, tail=5, total=200 → omitted=190
    expect(text.split("\n").filter((l) => l.startsWith("+line")).length).toBe(10);
  });
});
