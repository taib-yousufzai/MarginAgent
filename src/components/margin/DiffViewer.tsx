import { useMemo } from "react";

function tokenize(line: string) {
  return line;
}

interface Hunk {
  type: "context" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Minimal LCS-based line diff — enough for readable review UI. */
function diffLines(before: string, after: string): Hunk[] {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i]!, oldNo: oldNo++, newNo: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", text: a[i]!, oldNo: oldNo++ });
      i++;
    } else {
      out.push({ type: "add", text: b[j]!, newNo: newNo++ });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: a[i++]!, oldNo: oldNo++ });
  while (j < n) out.push({ type: "add", text: b[j++]!, newNo: newNo++ });
  return out;
}

export function DiffViewer({
  before,
  after,
  view = "unified",
}: {
  before: string;
  after: string;
  view?: "unified" | "split";
}) {
  const hunks = useMemo(() => diffLines(before, after), [before, after]);

  if (view === "split") {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border font-mono text-[12.5px] leading-6">
        {(["del", "add"] as const).map((side) => (
          <div key={side} className="bg-surface">
            {hunks
              .filter((h) => h.type === "context" || h.type === side)
              .map((h, index) => (
                <div
                  key={index}
                  className="flex gap-3 px-3"
                  style={
                    h.type === "add"
                      ? { background: "var(--diff-add)" }
                      : h.type === "del"
                        ? { background: "var(--diff-del)" }
                        : undefined
                  }
                >
                  <span className="w-7 shrink-0 select-none text-right text-muted-foreground/60">
                    {h.type === "add" ? h.newNo : h.oldNo}
                  </span>
                  <span className="whitespace-pre-wrap break-words text-foreground/90">
                    {tokenize(h.text) || " "}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-surface font-mono text-[12.5px] leading-6">
      {hunks.map((h, index) => (
        <div
          key={index}
          className="flex gap-3 px-3"
          style={
            h.type === "add"
              ? { background: "var(--diff-add)" }
              : h.type === "del"
                ? { background: "var(--diff-del)" }
                : undefined
          }
        >
          <span className="w-7 shrink-0 select-none text-right text-muted-foreground/50">
            {h.oldNo ?? ""}
          </span>
          <span className="w-7 shrink-0 select-none text-right text-muted-foreground/50">
            {h.newNo ?? ""}
          </span>
          <span
            className={
              h.type === "add"
                ? "w-3 shrink-0 select-none text-success"
                : h.type === "del"
                  ? "w-3 shrink-0 select-none text-destructive"
                  : "w-3 shrink-0 select-none text-muted-foreground/40"
            }
          >
            {h.type === "add" ? "+" : h.type === "del" ? "−" : ""}
          </span>
          <span className="whitespace-pre-wrap break-words text-foreground/90">
            {tokenize(h.text) || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
