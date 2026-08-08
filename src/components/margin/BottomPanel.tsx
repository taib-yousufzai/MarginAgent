import { Check, ChevronUp, CircleAlert, CircleX, Minus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiffViewer } from "@/components/margin/DiffViewer";
import { useStore } from "@/lib/agent/store";
import type { Task } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{text}</p>;
}

export function BottomPanel({
  task,
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const { reviewChange, openDrawer } = useStore();

  const counts = {
    changes: task?.changes.length ?? 0,
    terminal: task?.terminal.length ?? 0,
    tests: task?.tests.at(-1),
    problems: task?.problems.length ?? 0,
  };

  if (!open) {
    return (
      <div className="hairline-t flex h-9 shrink-0 items-center gap-1 bg-surface px-3">
        {(
          [
            ["changes", `Changes${counts.changes ? ` ${counts.changes}` : ""}`],
            ["terminal", "Terminal"],
            [
              "tests",
              counts.tests ? `Tests ${counts.tests.passed}/${counts.tests.passed + counts.tests.failed}` : "Tests",
            ],
            ["problems", `Problems${counts.problems ? ` ${counts.problems}` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              onTabChange(key);
              onOpenChange(true);
            }}
            className="rounded-md px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => onOpenChange(true)}
          aria-label="Open panel"
        >
          <ChevronUp className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="hairline-t flex h-[42vh] shrink-0 flex-col bg-surface">
      <Tabs value={tab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex h-9 shrink-0 items-center px-3">
          <TabsList className="h-7 bg-transparent p-0">
            {(["changes", "terminal", "tests", "problems"] as const).map((key) => (
              <TabsTrigger
                key={key}
                value={key}
                className="h-7 rounded-md px-2.5 text-[12.5px] capitalize data-[state=active]:bg-secondary"
              >
                {key}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            onClick={() => onOpenChange(false)}
            aria-label="Close panel"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="changes" className="m-0">
            {task?.changes.length ? (
              <div className="space-y-4 p-4">
                {task.changes.map((change) => (
                  <div key={change.id} className="overflow-hidden rounded-xl bg-surface-raised">
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <span className="font-mono text-[12.5px] text-foreground/90">
                        {change.path}
                      </span>
                      <span className="text-[12px] text-success">+{change.additions}</span>
                      <span className="text-[12px] text-destructive">−{change.deletions}</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {change.review === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-[12.5px] text-success"
                              onClick={() => reviewChange(task.id, change.id, "accepted")}
                            >
                              <Check className="size-3.5" /> Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-[12.5px] text-muted-foreground"
                              onClick={() => reviewChange(task.id, change.id, "rejected")}
                            >
                              <X className="size-3.5" /> Reject
                            </Button>
                          </>
                        ) : (
                          <span
                            className={cn(
                              "text-[12px] font-medium capitalize",
                              change.review === "accepted"
                                ? "text-success"
                                : "text-muted-foreground",
                            )}
                          >
                            {change.review}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12.5px]"
                          onClick={() => openDrawer({ type: "diff", changeId: change.id })}
                        >
                          Expand
                        </Button>
                      </div>
                    </div>
                    <div className="px-2 pb-2">
                      <DiffViewer before={change.before} after={change.after} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No file changes yet. The agent will list every edit here for review." />
            )}
          </TabsContent>

          <TabsContent value="terminal" className="m-0">
            {task?.terminal.length ? (
              <div className="space-y-3 p-4 font-mono text-[12.5px] leading-6">
                {task.terminal.map((exec) => (
                  <div key={exec.id} className="rounded-xl bg-surface-raised p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          exec.status === "success"
                            ? "bg-success"
                            : exec.status === "failed"
                              ? "bg-destructive"
                              : "bg-warning",
                        )}
                      />
                      <span className="text-foreground/90">$ {exec.command}</span>
                      <span
                        className={cn(
                          "ml-auto text-[11.5px]",
                          exec.status === "success" ? "text-success" : "text-destructive",
                        )}
                      >
                        exit {exec.exitCode}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap text-muted-foreground">{exec.output}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No commands run in this task." />
            )}
          </TabsContent>

          <TabsContent value="tests" className="m-0">
            {task?.tests.length ? (
              <div className="space-y-3 p-4">
                {task.tests.map((run) => (
                  <div key={run.id} className="rounded-xl bg-surface-raised p-4">
                    <div className="flex items-center gap-4 text-[13px]">
                      <span className="font-mono text-foreground/90">{run.command}</span>
                      <span className="text-success">{run.passed} passed</span>
                      <span className={run.failed ? "text-destructive" : "text-muted-foreground"}>
                        {run.failed} failed
                      </span>
                      <span className="text-muted-foreground">{run.skipped} skipped</span>
                      <span className="ml-auto text-muted-foreground">
                        {(run.durationMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                    {run.failures.map((failure) => (
                      <button
                        key={failure.name}
                        type="button"
                        onClick={() => openDrawer({ type: "test-failure", testRunId: run.id })}
                        className="mt-3 flex w-full items-start gap-2 rounded-lg bg-destructive/8 p-3 text-left"
                      >
                        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span className="text-[13px]">
                          <span className="block text-foreground/90">{failure.name}</span>
                          <span className="font-mono text-[11.5px] text-muted-foreground">
                            {failure.file}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No test runs in this task." />
            )}
          </TabsContent>

          <TabsContent value="problems" className="m-0">
            {task?.problems.length ? (
              <ul className="divide-y">
                {task.problems.map((problem) => (
                  <li key={problem.id} className="flex items-start gap-3 px-4 py-3">
                    {problem.severity === "error" ? (
                      <CircleX className="mt-0.5 size-4 text-destructive" />
                    ) : problem.severity === "warning" ? (
                      <CircleAlert className="mt-0.5 size-4 text-warning" />
                    ) : (
                      <Minus className="mt-0.5 size-4 text-muted-foreground" />
                    )}
                    <div className="text-[13px]">
                      <p className="text-foreground/90">{problem.message}</p>
                      <p className="font-mono text-[11.5px] text-muted-foreground">
                        {problem.file}:{problem.line} · {problem.source}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty text="No lint, type, build or runtime problems reported." />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
