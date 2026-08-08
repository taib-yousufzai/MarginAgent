import { useMemo, useState, useEffect } from "react";
import {
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  History,
  Loader2,
  Network,
  PanelLeftClose,
  RefreshCw,
  Search,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/agent/store";
import { flattenFiles } from "@/lib/agent/demo-workspace";
import { isTauri, cbmStartUi, cbmUiStatus } from "@/lib/agent/tauri-bridge";
import type { FileNode } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function FileIcon({ name }: { name: string }) {
  const Icon = /\.(tsx?|jsx?|css)$/.test(name) ? FileCode2 : FileText;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function TreeNode({
  node,
  depth,
  onOpen,
}: {
  node: FileNode;
  depth: number;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.kind === "file") {
    return (
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        className="group flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-sidebar-accent"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <FileIcon name={node.name} />
        <span className="truncate">{node.name}</span>
        {node.gitStatus ? (
          <span className="ml-auto text-[10px] font-semibold uppercase text-warning">
            {node.gitStatus === "modified" ? "M" : node.gitStatus === "added" ? "A" : "U"}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-sidebar-accent"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <ChevronRight
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {open ? (
          <FolderOpen className="size-3.5 text-primary/80" />
        ) : (
          <Folder className="size-3.5 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open
        ? (node.children ?? []).map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />
          ))
        : null}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof Search;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="px-2 py-3">
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const { project, tasks, selectTask, activeTaskId, openDrawer, refreshProject } = useStore();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"files" | "graph">("files");
  const [graphUrl, setGraphUrl] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshProject();
    setRefreshing(false);
  };

  const openGraph = async () => {
    if (!isTauri) {
      setGraphUrl("http://localhost:9749");
      return;
    }
    setGraphLoading(true);
    setGraphError(null);
    try {
      // Check if already up first (fast)
      const up = await cbmUiStatus();
      if (up) {
        setGraphUrl("http://localhost:9749");
      } else {
        const url = await cbmStartUi();
        setGraphUrl(url);
      }
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : String(e));
    } finally {
      setGraphLoading(false);
    }
  };

  // Auto-open graph when tab is clicked
  useEffect(() => {
    if (activeTab === "graph" && !graphUrl && !graphLoading) {
      void openGraph();
    }
  }, [activeTab]);

  const results = useMemo(() => {
    if (!project || query.trim().length < 2) return [];
    return flattenFiles(project.tree)
      .filter(
        (file) =>
          file.path.toLowerCase().includes(query.toLowerCase()) ||
          (file.content ?? "").toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 6);
  }, [project, query]);

  const changed = useMemo(
    () => (project ? flattenFiles(project.tree).filter((f) => f.gitStatus) : []),
    [project],
  );

  return (
    <aside className="hairline-b flex h-full w-[268px] shrink-0 flex-col overflow-hidden border-r bg-sidebar">
      {/* Header */}
      <div className="flex h-10 items-center justify-between px-3">
        <span className="font-mono text-[11.5px] text-muted-foreground truncate">
          {project?.workspacePath}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {activeTab === "files" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleRefresh}
              aria-label="Refresh file tree"
              title="Refresh"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-2">
        <button
          type="button"
          onClick={() => setActiveTab("files")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            activeTab === "files"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Folder className="size-3" />
          Files
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("graph")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            activeTab === "graph"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Network className="size-3" />
          Graph
        </button>
      </div>

      {/* Files tab */}
      {activeTab === "files" && (
        <div className="scroll-slim flex-1 overflow-y-auto pb-6">
          <Section icon={Search} title="Search">
            <div className="px-1">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find in project"
                className="h-8 bg-surface text-[13px]"
              />
            </div>
            {results.length ? (
              <ul className="mt-2 space-y-0.5 px-1">
                {results.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => openDrawer({ type: "file", path: file.path })}
                      className="w-full truncate rounded-md px-2 py-1 text-left font-mono text-[11.5px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    >
                      {file.path}
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 ? (
              <p className="mt-2 px-3 text-[12px] text-muted-foreground">No matches.</p>
            ) : null}
          </Section>

          <Section icon={Folder} title="Project files">
            {project?.tree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onOpen={(path) => openDrawer({ type: "file", path })}
              />
            ))}
          </Section>

          <Section icon={GitCompare} title="Git changes">
            {changed.length ? (
              <ul className="space-y-0.5">
                {changed.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => openDrawer({ type: "file", path: file.path })}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-left text-[13px] hover:bg-sidebar-accent"
                    >
                      <span className="text-[10px] font-semibold uppercase text-warning">M</span>
                      <span className="truncate text-foreground/85">{file.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 text-[12px] text-muted-foreground">Working tree clean.</p>
            )}
          </Section>

          <Section icon={History} title="Recent tasks">
            {tasks.length ? (
              <ul className="space-y-0.5">
                {tasks.slice(0, 8).map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => selectTask(task.id)}
                      className={cn(
                        "w-full rounded-md px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-sidebar-accent",
                        activeTaskId === task.id && "bg-sidebar-accent text-foreground",
                      )}
                    >
                      <span className="line-clamp-1">{task.title}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {task.mode} · {task.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 text-[12px] text-muted-foreground">No tasks yet.</p>
            )}
          </Section>
        </div>
      )}

      {/* Graph tab */}
      {activeTab === "graph" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <Network className="size-10 text-primary/60" />
          <div>
            <p className="text-[13.5px] font-medium">Codebase Knowledge Graph</p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              3D interactive visualization of your codebase — functions, classes, call chains, dependencies.
            </p>
          </div>

          {graphError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {graphError}
            </p>
          )}

          <button
            type="button"
            disabled={graphLoading}
            onClick={() => void openGraph()}
            className="flex items-center gap-2 rounded-lg bg-primary/15 px-4 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
          >
            {graphLoading ? (
              <><Loader2 className="size-4 animate-spin" /> Starting…</>
            ) : (
              <><Network className="size-4" /> Open Graph Window</>
            )}
          </button>

          {graphUrl && (
            <p className="text-[11px] text-muted-foreground">
              Running at{" "}
              <code className="font-mono">{graphUrl}</code>
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
