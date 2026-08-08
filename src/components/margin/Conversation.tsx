import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  CircleCheck,
  FileSearch,
  FlaskConical,
  ListChecks,
  Loader2,
  Pencil,
  Search,
  Sparkle,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/agent/store";
import type { Message, StepKind, Task } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<StepKind, typeof Search> = {
  understand: Sparkle,
  search: Search,
  read: FileSearch,
  plan: ListChecks,
  edit: Pencil,
  command: TerminalSquare,
  test: FlaskConical,
  summary: CircleCheck,
};

// ─── Lightweight markdown renderer ───────────────────────────────────────────
// Handles: **bold**, *italic*, `code`, ```fenced```, # headings, - bullets, blank lines

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre key={key++} className="my-3 overflow-x-auto rounded-lg bg-surface p-4 font-mono text-[12.5px] leading-6 text-foreground/90">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Headings
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#+)/)![1]!.length;
      const content = line.replace(/^#+\s/, "");
      const cls = level === 1
        ? "mt-4 mb-1 text-[17px] font-semibold"
        : level === 2
          ? "mt-3 mb-1 text-[15px] font-semibold"
          : "mt-2 mb-0.5 text-[14px] font-semibold";
      nodes.push(<p key={key++} className={cls}>{inlineFormat(content)}</p>);
      i++;
      continue;
    }

    // Unordered list item
    if (/^[-*+]\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!.trimStart())) {
        items.push(lines[i]!.trimStart().replace(/^[-*+]\s/, ""));
        i++;
      }
      nodes.push(
        <ul key={key++} className="my-1.5 space-y-1 pl-5 list-disc marker:text-muted-foreground">
          {items.map((item, idx) => (
            <li key={idx} className="text-[14.5px] leading-7 text-foreground/90">
              {inlineFormat(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!.trimStart())) {
        items.push(lines[i]!.trimStart().replace(/^\d+\.\s/, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} className="my-1.5 space-y-1 pl-5 list-decimal marker:text-muted-foreground">
          {items.map((item, idx) => (
            <li key={idx} className="text-[14.5px] leading-7 text-foreground/90">
              {inlineFormat(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      nodes.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Paragraph
    nodes.push(
      <p key={key++} className="text-[14.5px] leading-7 text-foreground/92">
        {inlineFormat(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

// Inline formatting: **bold**, *italic*, `code`
function inlineFormat(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Split on **bold**, *italic*, `code`
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0]!;
    if (token.startsWith("**")) {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={key++} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key++} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground/90">{token.slice(1, -1)}</code>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── Thinking block ───────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const wordCount = text.trim().split(/\s+/).length;

  return (
    <div className="rounded-xl border border-border bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <Brain className="size-3.5 shrink-0 text-primary/70" />
        <span className="text-[12.5px] font-medium text-muted-foreground">
          Thought for {wordCount} words
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <p className="whitespace-pre-wrap text-[13px] leading-6 italic text-muted-foreground">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

function ActivityFeed({ message }: { message: Message }) {
  // Only show steps that have actual content — filter out stuck "running" steps
  // if the task is already complete (they should have been finished)
  const steps = (message.steps ?? []).filter((s) => s.label && s.label !== "Thinking…" || s.status !== "running");

  if (steps.length === 0) return null;

  return (
    <ol className="relative ml-3 space-y-3 border-l pl-7">
      {steps.map((step) => {
        const Icon = STEP_ICON[step.kind];
        const running = step.status === "running";
        return (
          <li key={step.id} className="animate-rise">
            <span
              className={cn(
                "absolute -left-[11px] grid size-[22px] place-items-center rounded-full bg-surface-raised",
                running ? "text-primary" : "text-muted-foreground",
              )}
            >
              {running ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Icon className="size-3" />
              )}
            </span>
            <p
              className={cn(
                "text-[14px] leading-6",
                running ? "text-foreground" : "text-foreground/75",
              )}
            >
              {step.label}
            </p>
            {step.detail ? (
              <p className="mt-0.5 whitespace-pre-wrap font-mono text-[11.5px] leading-5 text-muted-foreground">
                {step.detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Message blocks ───────────────────────────────────────────────────────────

function MessageBlock({ message, taskComplete }: { message: Message; taskComplete: boolean }) {
  const { openDrawer } = useStore();

  if (message.role === "user") {
    return (
      <div className="animate-rise flex justify-end">
        <div className="max-w-[76%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14.5px] leading-6 text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === "thinking") {
    return (
      <div className="animate-rise">
        <ThinkingBlock text={message.text} />
      </div>
    );
  }

  if (message.role === "activity") {
    // If task is complete, hide activity steps that are still marked running
    // (they were left behind when the LLM started responding)
    const visibleSteps = taskComplete
      ? (message.steps ?? []).filter((s) => s.status !== "running")
      : (message.steps ?? []);

    if (visibleSteps.length === 0) return null;

    return (
      <div className="animate-rise">
        <ol className="relative ml-3 space-y-3 border-l pl-7">
          {visibleSteps.map((step) => {
            const Icon = STEP_ICON[step.kind];
            const running = step.status === "running";
            return (
              <li key={step.id}>
                <span
                  className={cn(
                    "absolute -left-[11px] grid size-[22px] place-items-center rounded-full bg-surface-raised",
                    running ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {running ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Icon className="size-3" />
                  )}
                </span>
                <p className={cn("text-[14px] leading-6", running ? "text-foreground" : "text-foreground/75")}>
                  {step.label}
                </p>
                {step.detail ? (
                  <p className="mt-0.5 whitespace-pre-wrap font-mono text-[11.5px] leading-5 text-muted-foreground">
                    {step.detail}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (message.role === "warning") {
    return (
      <div className="animate-rise flex items-start gap-3 rounded-xl bg-warning/8 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex-1 text-[14px] leading-6 text-foreground/90">
          {message.text}
          {message.drawerRef ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-2 py-0 text-warning"
              onClick={() => message.drawerRef && openDrawer(message.drawerRef)}
            >
              Review
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (message.role === "summary") {
    return (
      <div className="animate-rise rounded-xl bg-surface-raised px-4 py-3.5">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-success">
          <Check className="size-3.5" /> Completed
        </div>
        <p className="text-[14.5px] leading-7 text-foreground/90">
          {message.text}
        </p>
      </div>
    );
  }

  // Agent message — render markdown
  return (
    <div className="animate-rise space-y-1">
      {renderMarkdown(message.text)}
      {message.plan ? (
        <ol className="mt-2 space-y-2 rounded-xl bg-surface-raised px-4 py-3.5">
          {message.plan.map((item, index) => (
            <li key={item} className="flex gap-3 text-[14px] leading-6 text-foreground/85">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export function Conversation({ task }: { task: Task }) {
  const endRef = useRef<HTMLDivElement>(null);
  const taskComplete = task.status === "complete" || task.status === "stopped" || task.status === "failed";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [task.messages]);

  return (
    <div className="scroll-slim flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-6 py-8">
        {task.messages.map((message) => (
          <MessageBlock key={message.id} message={message} taskComplete={taskComplete} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
