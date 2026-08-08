import { Loader2, ChevronDown, Circle, FolderOpen, GitBranch, Settings2, ShieldCheck, Terminal, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStore } from "@/lib/agent/store";
import type { ExecutionEnvironment } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

const ENV_META: Record<
  ExecutionEnvironment,
  { label: string; className: string; dot: string }
> = {
  demo: {
    label: "Demo mode",
    className: "text-warning",
    dot: "bg-warning",
  },
  connected: {
    label: "Model ready",
    className: "text-success",
    dot: "bg-success",
  },
  disconnected: {
    label: "Add API key in Settings",
    className: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  error: { label: "Connection error", className: "text-destructive", dot: "bg-destructive" },
};

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { project, environment, openProject, isLoadingProject } = useStore();
  const env = ENV_META[environment];

  return (
    <header className="hairline-b flex h-12 shrink-0 items-center gap-3 bg-surface px-3">
      <a href="/" className="flex items-center gap-2 pr-1">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <Terminal className="size-3.5" />
        </span>
        <span className="font-display text-[15px] font-semibold tracking-tight">MarginAgent</span>
      </a>

      <span className="h-4 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px]">
            {project?.name ?? "No project"}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          <DropdownMenuItem className="flex-col items-start gap-0.5">
            <span className="text-[13px]">{project?.name ?? "No project open"}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {project?.workspacePath ?? "Open a folder to get started"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void openProject()}>
            {isLoadingProject ? (
              <><Loader2 className="size-3.5 animate-spin" /> Opening…</>
            ) : (
              <><FolderOpen className="size-3.5" /> Open folder…</>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {project ? (
        <div className="hidden items-center gap-3 text-[12.5px] text-muted-foreground md:flex">
          <span className="flex items-center gap-1.5">
            <GitBranch className="size-3.5" />
            {project.branch}
          </span>
          <span className="flex items-center gap-1.5">
            <Circle className="size-2 fill-warning text-warning" />
            {project.dirtyFiles} changed
          </span>
          <span>↑{project.ahead}</span>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full bg-surface-raised px-2.5 py-1 text-[12px] font-medium",
            env.className,
          )}
        >
          <span className="relative flex size-1.5">
            <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", env.dot)} />
            <span className={cn("size-1.5 rounded-full", env.dot)} />
          </span>
          {env.label}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings2 className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Account">
              <span className="grid size-6 place-items-center rounded-full bg-secondary text-[11px] font-semibold">
                <User className="size-3.5" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-[13px]">Local developer</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Everything runs on your machine
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <ShieldCheck className="size-4" /> Agent permissions
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenSettings}>Settings</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
