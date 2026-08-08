import { useEffect, useState } from "react";
import { Loader2, PanelLeftOpen, Plus, Sparkle, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApprovalDialog } from "@/components/margin/ApprovalDialog";
import { BottomPanel } from "@/components/margin/BottomPanel";
import { Composer } from "@/components/margin/Composer";
import { Conversation } from "@/components/margin/Conversation";
import { ContextDrawer } from "@/components/margin/ContextDrawer";
import { SettingsDialog } from "@/components/margin/SettingsDialog";
import { Sidebar } from "@/components/margin/Sidebar";
import { TopBar } from "@/components/margin/TopBar";
import { Welcome } from "@/components/margin/Welcome";
import { exampleTasks } from "@/lib/agent/demo-workspace";
import { StoreProvider, useStore } from "@/lib/agent/store";
import { MODE_LABELS } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function TaskHeader() {
  const { activeTask, isRunning, openDrawer, selectTask } = useStore();

  return (
    <div className="hairline-b flex h-11 shrink-0 items-center gap-3 px-6">
      <h1 className="truncate text-[14.5px] font-medium">
        {activeTask?.title ?? "New task"}
      </h1>
      {activeTask ? (
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
            activeTask.status === "complete"
              ? "text-success"
              : activeTask.status === "running"
                ? "text-primary"
                : activeTask.status === "awaiting-approval"
                  ? "text-warning"
                  : "text-muted-foreground",
          )}
        >
          {isRunning ? <Loader2 className="size-3 animate-spin" /> : null}
          {activeTask.status === "awaiting-approval"
            ? "Waiting for approval"
            : activeTask.status.charAt(0).toUpperCase() + activeTask.status.slice(1)}
        </span>
      ) : null}
      <span className="text-[11.5px] text-muted-foreground">
        {activeTask ? MODE_LABELS[activeTask.mode].label : ""}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {activeTask ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12.5px] text-muted-foreground"
            onClick={() => openDrawer({ type: "run-details", taskId: activeTask.id })}
          >
            Run details
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[12.5px]"
          onClick={() => selectTask(null)}
        >
          <Plus className="size-3.5" /> New task
        </Button>
      </div>
    </div>
  );
}

function EmptyTask() {
  const { runTask, settings } = useStore();

  return (
    <div className="scroll-slim flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[820px] flex-col justify-center px-6 py-16">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary">
          <Sparkle className="size-4" />
        </span>
        <h2 className="mt-5 text-[26px] font-semibold leading-tight">
          What should the agent work on?
        </h2>
        <p className="mt-2 max-w-[440px] text-[14.5px] leading-7 text-muted-foreground">
          Describe a change, a bug, or a question. The agent inspects the project, shows a plan, and
          asks before it writes anything.
        </p>
        <ul className="mt-8 grid gap-1.5 sm:grid-cols-2">
          {exampleTasks.map((task) => (
            <li key={task}>
              <button
                type="button"
                onClick={() => void runTask(task, settings.defaultMode)}
                className="w-full rounded-xl bg-surface px-4 py-3 text-left text-[13.5px] leading-6 text-foreground/85 transition-colors hover:bg-surface-raised"
              >
                "{task}"
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MarginAgent() {
  const { ready, project, activeTask, openProject, isLoadingProject } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("changes");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((v) => !v);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setPanelOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || isLoadingProject) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-6 text-center px-8">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
            <FolderOpen className="size-7" />
          </span>
          <div>
            <h1 className="font-display text-[28px] font-semibold">Open a project</h1>
            <p className="mt-2 max-w-[360px] text-[14.5px] leading-7 text-muted-foreground">
              Choose a folder on your machine to start working with the AI agent.
            </p>
          </div>
          <Button size="lg" className="h-11 gap-2 px-6" onClick={() => void openProject()}>
            <FolderOpen className="size-4" /> Choose folder…
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <Sidebar onCollapse={() => setSidebarOpen(false)} />
        ) : (
          <div className="flex w-10 shrink-0 flex-col items-center border-r bg-sidebar py-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setSidebarOpen(true)}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TaskHeader />
          {activeTask ? <Conversation task={activeTask} /> : <EmptyTask />}
          <Composer />
          <BottomPanel
            task={activeTask}
            open={panelOpen}
            onOpenChange={setPanelOpen}
            tab={panelTab}
            onTabChange={setPanelTab}
          />
        </div>
      </div>

      <ContextDrawer />
      <ApprovalDialog />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default function IndexPage() {
  return (
    <StoreProvider>
      <TooltipProvider delayDuration={300}>
        <MarginAgent />
      </TooltipProvider>
    </StoreProvider>
  );
}
