import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DiffViewer } from "@/components/margin/DiffViewer";
import { findFile } from "@/lib/agent/demo-workspace";
import { useStore } from "@/lib/agent/store";
import { isTauri, readFile } from "@/lib/agent/tauri-bridge";

export function ContextDrawer() {
  const { drawer, closeDrawer, project, activeTask, tasks, resolveApproval } = useStore();
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Load real file content via Tauri when drawer opens on a file
  useEffect(() => {
    if (drawer?.type !== "file") {
      setFileContent(null);
      return;
    }
    if (isTauri && project && !project.demo) {
      setFileLoading(true);
      readFile(drawer.path)
        .then((c) => setFileContent(c))
        .catch(() => setFileContent(null))
        .finally(() => setFileLoading(false));
    } else {
      const file = project ? findFile(project.tree, drawer.path) : undefined;
      setFileContent(file?.content ?? null);
    }
  }, [drawer, project]);

  const content = useMemo(() => {
    if (!drawer) return null;

    if (drawer.type === "file") {
      return {
        title: drawer.path.split(/[/\\]/).pop() ?? drawer.path,
        description: drawer.path,
        body: fileLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <pre className="scroll-slim overflow-auto rounded-xl bg-surface p-4 font-mono text-[12.5px] leading-6 text-foreground/90">
            {fileContent ?? "This file has no preview available."}
          </pre>
        ),
      };
    }

    if (drawer.type === "diff") {
      const change = tasks.flatMap((t) => t.changes).find((c) => c.id === drawer.changeId);
      return {
        title: change?.path ?? "Diff",
        description: change ? `+${change.additions} −${change.deletions}` : "",
        body: change ? (
          <DiffViewer before={change.before} after={change.after} view="split" />
        ) : null,
      };
    }

    if (drawer.type === "approval") {
      const approval = tasks.flatMap((t) => t.approvals).find((a) => a.id === drawer.approvalId);
      return {
        title: approval?.title ?? "Approval",
        description: approval?.description ?? "",
        body: approval ? (
          <div className="space-y-4">
            <ul className="space-y-1.5 rounded-xl bg-surface p-4 font-mono text-[12.5px] text-muted-foreground">
              {approval.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            {approval.status === "pending" ? (
              <div className="flex gap-2">
                <Button onClick={() => { resolveApproval(approval.id, true); closeDrawer(); }}>
                  Approve
                </Button>
                <Button variant="secondary" onClick={() => { resolveApproval(approval.id, false); closeDrawer(); }}>
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-[13px] capitalize text-muted-foreground">{approval.status}</p>
            )}
          </div>
        ) : null,
      };
    }

    if (drawer.type === "test-failure") {
      const run = tasks.flatMap((t) => t.tests).find((r) => r.id === drawer.testRunId);
      return {
        title: "Test failure details",
        description: run?.command ?? "",
        body: (
          <div className="space-y-3">
            {(run?.failures ?? []).map((failure) => (
              <div key={failure.name} className="rounded-xl bg-surface p-4">
                <p className="text-[14px] text-foreground/90">{failure.name}</p>
                <p className="mb-2 font-mono text-[11.5px] text-muted-foreground">{failure.file}</p>
                <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-6 text-destructive/90">
                  {failure.message}
                </pre>
              </div>
            ))}
          </div>
        ),
      };
    }

    return {
      title: "Agent run details",
      description: activeTask?.title ?? "",
      body: (
        <ul className="space-y-2 text-[13px] text-muted-foreground">
          <li>Mode: {activeTask?.mode}</li>
          <li>Status: {activeTask?.status}</li>
          <li>Files changed: {activeTask?.changes.length ?? 0}</li>
          <li>Commands run: {activeTask?.terminal.length ?? 0}</li>
          <li>Test runs: {activeTask?.tests.length ?? 0}</li>
        </ul>
      ),
    };
  }, [drawer, fileContent, fileLoading, project, tasks, activeTask, resolveApproval, closeDrawer]);

  return (
    <Sheet open={Boolean(drawer)} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent side="right" className="w-full gap-0 bg-surface-raised sm:max-w-[620px]">
        <SheetHeader className="gap-1">
          <SheetTitle className="font-mono text-[14px]">{content?.title}</SheetTitle>
          <SheetDescription className="text-[12.5px]">{content?.description}</SheetDescription>
        </SheetHeader>
        <div className="scroll-slim flex-1 overflow-y-auto px-4 pb-6">{content?.body}</div>
      </SheetContent>
    </Sheet>
  );
}
