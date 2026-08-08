import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { demoProject } from "./demo-workspace";
import { realRun, titleFromPrompt, type RunEvent } from "./runner";
import { isTauri, pickFolder, loadProject, readFile, cbmIndex } from "./tauri-bridge";
import {
  buildMemoryContext,
  buildConversationHistory,
  extractAndSaveMemory,
  addMemoryEntry,
} from "./memory";
import type {
  AgentMode,
  AgentStep,
  Approval,
  DrawerTarget,
  ExecutionEnvironment,
  Message,
  Project,
  Settings,
  Task,
} from "./types";

const STORAGE_KEY = "marginagent.state.v2";

const defaultSettings: Settings = {
  provider: "openai-compatible",
  baseUrl: "http://localhost:3001/v1", // FreeLLMAPI default
  apiKey: "",
  modelId: "auto",                     // FreeLLMAPI supports "auto" routing
  temperature: 0.3,
  maxSteps: 24,
  defaultMode: "agent",
  safeMode: false,
  autoApproveSafeActions: true,
  autoRunTests: false,
  maxRetries: 3,
  companionUrl: "http://localhost:3000",
  companionToken: "",
  activeSkills: [],
};

interface PersistedState {
  tasks: Task[];
  settings: Settings;
  workspacePath: string | null;
}

interface StoreValue {
  ready: boolean;
  project: Project | null;
  tasks: Task[];
  activeTask: Task | null;
  activeTaskId: string | null;
  settings: Settings;
  environment: ExecutionEnvironment;
  pendingApproval: Approval | null;
  drawer: DrawerTarget | null;
  isRunning: boolean;
  isLoadingProject: boolean;
  // actions
  openProject(): Promise<void>;
  refreshProject(): Promise<void>;
  openDrawer(target: DrawerTarget): void;
  closeDrawer(): void;
  selectTask(id: string | null): void;
  updateSettings(patch: Partial<Settings>): void;
  runTask(prompt: string, mode: AgentMode): Promise<void>;
  stopRun(): void;
  resolveApproval(id: string, approved: boolean): void;
  reviewChange(taskId: string, changeId: string, review: "accepted" | "rejected"): void;
  deleteTask(id: string): void;
}

const StoreContext = createContext<StoreValue | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

function load(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    // Clear any old v1 state that would load demoProject
    window.localStorage.removeItem("marginagent.state.v1");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      tasks: parsed.tasks ?? [],
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      workspacePath: parsed.workspacePath ?? null,
    };
  } catch {
    return null;
  }
}

// Build a short project context string to inject into the LLM system prompt
function buildProjectContext(project: Project): string {
  if (project.demo) return "";
  const files: string[] = [];
  function walk(nodes: typeof project.tree) {
    for (const n of nodes) {
      if (n.kind === "file") files.push(n.path);
      else walk(n.children ?? []);
    }
  }
  walk(project.tree);
  return buildMemoryContext(project.id, project.workspacePath, project.branch, files);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);

  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const environment: ExecutionEnvironment = useMemo(() => {
    if (settings.baseUrl && settings.modelId && settings.apiKey) return "connected";
    if (settings.baseUrl && settings.modelId) return "disconnected"; // missing key
    return "disconnected";
  }, [settings.baseUrl, settings.modelId, settings.apiKey]);

  // Load persisted state and restore last workspace
  useEffect(() => {
    const persisted = load();
    if (persisted) {
      setTasks(persisted.tasks);
      setSettings(persisted.settings);
      setActiveTaskId(persisted.tasks[0]?.id ?? null);

      if (isTauri && persisted.workspacePath) {
        // Restore last real workspace
        setIsLoadingProject(true);
        loadProject(persisted.workspacePath)
          .then((p) => {
            setProject(p);
            // Index in background
            cbmIndex(persisted.workspacePath!).catch(() => {});
          })
          .catch(() => setProject(null))
          .finally(() => setIsLoadingProject(false));
      } else if (isTauri) {
        // Tauri, no saved workspace — null triggers "open a folder" UI
        setProject(null);
      } else {
        // Browser dev mode — use demo project so UI has something to show
        setProject(demoProject);
      }
    } else {
      setProject(isTauri ? null : demoProject);
    }
    setReady(true);
  }, []);

  // Persist on change (store workspace path, not the full tree)
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const payload: PersistedState = {
      tasks,
      settings,
      workspacePath: project && !project.demo ? project.workspacePath : null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [ready, tasks, settings, project]);

  const patchTask = useCallback((id: string, patch: (task: Task) => Task) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? patch({ ...t }) : t)));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Open a folder picker and load the selected project
  const openProject = useCallback(async () => {
    if (!isTauri) return;
    const folderPath = await pickFolder();
    if (!folderPath) return;

    setIsLoadingProject(true);
    try {
      const loaded = await loadProject(folderPath);
      setProject(loaded);
      setTasks([]);
      setActiveTaskId(null);
      // Index in background — non-blocking
      cbmIndex(folderPath).catch(() => {/* CBM indexing is best-effort */});
    } catch (err) {
      console.error("Failed to load project:", err);
    } finally {
      setIsLoadingProject(false);
    }
  }, []);

  // Refresh the current project's file tree and git status from disk
  const refreshProject = useCallback(async () => {
    if (!isTauri || !project || project.demo) return;
    try {
      const refreshed = await loadProject(project.workspacePath);
      setProject(refreshed);
    } catch (err) {
      console.error("Failed to refresh project:", err);
    }
  }, [project]);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    setPendingApproval(null);
    setTasks((prev) =>
      prev.map((task) => ({
        ...task,
        approvals: task.approvals.map((a) =>
          a.id === id ? { ...a, status: approved ? "approved" : "rejected" } : a,
        ),
      })),
    );
    approvalResolver.current?.(approved);
    approvalResolver.current = null;
  }, []);

  const stopRun = useCallback(() => {
    abortController.current?.abort();
    approvalResolver.current?.(false);
    approvalResolver.current = null;
    setPendingApproval(null);
  }, []);

  const runTask = useCallback(
    async (prompt: string, mode: AgentMode) => {
      if (!prompt.trim() || isRunning) return;

      // Guard: require API key
      if (!settings.apiKey) {
        const taskId = uid();
        const now = Date.now();
        const task: Task = {
          id: taskId,
          projectId: project?.id ?? "local",
          title: titleFromPrompt(prompt),
          prompt,
          mode,
          status: "failed",
          createdAt: now,
          updatedAt: now,
          messages: [
            { id: uid(), role: "user", text: prompt.trim(), at: now },
            { id: uid(), role: "warning", text: "No API key configured. Open Settings → AI model and paste your freellmapi-… key.", at: now },
          ],
          changes: [], terminal: [], tests: [], problems: [], approvals: [],
        };
        setTasks((prev) => [task, ...prev]);
        setActiveTaskId(taskId);
        return;
      }

      const now = Date.now();
      const taskId = uid();
      const task: Task = {
        id: taskId,
        projectId: project?.id ?? "local",
        title: titleFromPrompt(prompt),
        prompt,
        mode,
        status: "running",
        createdAt: now,
        updatedAt: now,
        messages: [{ id: uid(), role: "user", text: prompt.trim(), at: now }],
        changes: [],
        terminal: [],
        tests: [],
        problems: [],
        approvals: [],
      };

      setTasks((prev) => [task, ...prev]);
      setActiveTaskId(taskId);
      setIsRunning(true);

      const ctrl = new AbortController();
      abortController.current = ctrl;

      const activityMessageId = uid();

      const pushMessage = (message: Message) =>
        patchTask(taskId, (t) => ({ ...t, messages: [...t.messages, message], updatedAt: Date.now() }));

      const pushStep = (step: AgentStep) =>
        patchTask(taskId, (t) => {
          const messages = [...t.messages];
          const idx = messages.findIndex((m) => m.id === activityMessageId);
          if (idx === -1) {
            messages.push({ id: activityMessageId, role: "activity", text: "Agent activity", at: Date.now(), steps: [step] });
          } else {
            const existing = messages[idx]!;
            // Mark all previously running steps as done before adding the new one
            const steps = (existing.steps ?? []).map((s) =>
              s.status === "running" ? { ...s, status: "done" as const } : s,
            );
            messages[idx] = { ...existing, steps: [...steps, step] };
          }
          return { ...t, messages, updatedAt: Date.now() };
        });

      const finishSteps = () =>
        patchTask(taskId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.role === "activity"
              ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
              : m,
          ),
        }));

      const processEvent = async (event: RunEvent): Promise<boolean> => {
        switch (event.t) {
          case "thinking":
            // Emit thinking block atomically — finish running steps and add thinking message
            patchTask(taskId, (t) => {
              const messages = t.messages.map((m) =>
                m.role === "activity"
                  ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
                  : m,
              );
              return { ...t, messages: [...messages, { id: uid(), role: "thinking" as const, text: event.text, at: Date.now() }], updatedAt: Date.now() };
            });
            break;
          case "activity":
            pushStep({ id: uid(), kind: event.kind, label: event.label, detail: event.detail, status: "running", at: Date.now() });
            break;
          case "tool":
            pushStep({ id: uid(), kind: "search", label: event.text, detail: event.result, status: "running", at: Date.now() });
            break;
          case "agent":
            // Atomically: finish all running steps AND add the agent message in one patch
            patchTask(taskId, (t) => {
              const messages = t.messages.map((m) =>
                m.role === "activity"
                  ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
                  : m,
              );
              return { ...t, messages: [...messages, { id: uid(), role: "agent" as const, text: event.text, at: Date.now() }], updatedAt: Date.now() };
            });
            break;
          case "plan":
            patchTask(taskId, (t) => {
              const messages = t.messages.map((m) =>
                m.role === "activity"
                  ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
                  : m,
              );
              return { ...t, messages: [...messages, { id: uid(), role: "agent" as const, text: event.text, plan: event.items, at: Date.now() }], updatedAt: Date.now() };
            });
            break;
          case "approval": {
            const approval: Approval = { ...event.approval, id: uid(), status: "pending", at: Date.now() };
            patchTask(taskId, (t) => ({
              ...t,
              status: "awaiting-approval",
              approvals: [...t.approvals, approval],
              messages: [...t.messages, { id: uid(), role: "warning", text: `Approval required — ${approval.title}`, at: Date.now(), drawerRef: { type: "approval", approvalId: approval.id } }],
            }));
            setPendingApproval(approval);
            const approved = await new Promise<boolean>((resolve) => { approvalResolver.current = resolve; });
            if (!approved) {
              patchTask(taskId, (t) => ({ ...t, status: "stopped", messages: [...t.messages, { id: uid(), role: "summary", text: "Stopped.", at: Date.now() }] }));
              setIsRunning(false);
              return false;
            }
            patchTask(taskId, (t) => ({ ...t, status: "running" }));
            break;
          }
          case "changes":
            patchTask(taskId, (t) => ({ ...t, changes: [...t.changes, ...event.changes.map((c) => ({ ...c, id: uid(), review: "pending" as const }))], updatedAt: Date.now() }));
            break;
          case "terminal":
            patchTask(taskId, (t) => ({ ...t, terminal: [...t.terminal, { ...event.exec, id: uid(), at: Date.now() }], updatedAt: Date.now() }));
            break;
          case "tests":
            patchTask(taskId, (t) => ({ ...t, tests: [...t.tests, { ...event.run, id: uid(), at: Date.now() }], updatedAt: Date.now() }));
            break;
          case "problems":
            patchTask(taskId, (t) => ({ ...t, problems: [...t.problems, ...event.problems.map((p) => ({ ...p, id: uid() }))] }));
            break;
          case "warning":
            patchTask(taskId, (t) => {
              const messages = t.messages.map((m) =>
                m.role === "activity"
                  ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
                  : m,
              );
              return { ...t, messages: [...messages, { id: uid(), role: "warning" as const, text: event.text, at: Date.now() }], updatedAt: Date.now() };
            });
            break;
          case "summary":
            patchTask(taskId, (t) => {
              const messages = t.messages.map((m) =>
                m.role === "activity"
                  ? { ...m, steps: (m.steps ?? []).map((s) => s.status === "running" ? { ...s, status: "done" as const } : s) }
                  : m,
              );
              return { ...t, status: "complete", messages: [...messages, { id: uid(), role: "summary" as const, text: event.text, at: Date.now() }], updatedAt: Date.now() };
            });
            break;
        }
        return true;
      };

      // Build project context + conversation history for the LLM prompt
      const projectContext = project ? buildProjectContext(project) : undefined;
      const conversationHistory = project
        ? buildConversationHistory(project.id, taskId, tasks)
        : [];

      try {
        const stream = realRun(prompt, mode, settings, ctrl.signal, projectContext, project?.workspacePath, conversationHistory);
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;
          const ok = await processEvent(event);
          if (!ok) break;
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          finishSteps();
          const msg = err instanceof Error ? err.message : String(err);
          pushMessage({ id: uid(), role: "warning", text: `Error: ${msg}`, at: Date.now() });
          patchTask(taskId, (t) => ({ ...t, status: "failed", updatedAt: Date.now() }));
        }
      }

      if (ctrl.signal.aborted) {
        finishSteps();
        patchTask(taskId, (t) => ({ ...t, status: "stopped", messages: [...t.messages, { id: uid(), role: "summary", text: "Run stopped.", at: Date.now() }] }));
      }

      setIsRunning(false);
      abortController.current = null;

      // Save memory and task history after completion
      if (project && !project.demo) {
        // Get the final task state to extract memory from
        setTasks((prev) => {
          const finishedTask = prev.find((t) => t.id === taskId);
          if (finishedTask) {
            extractAndSaveMemory(project.id, finishedTask);
          }
          return prev;
        });
      }

      // Auto-refresh file tree after agent/edit run so sidebar reflects changes
      if ((mode === "agent" || mode === "edit") && isTauri && project && !project.demo) {
        void refreshProject();
      }
    },
    [isRunning, patchTask, project, settings, refreshProject],
  );

  const reviewChange = useCallback(
    (taskId: string, changeId: string, review: "accepted" | "rejected") => {
      patchTask(taskId, (t) => ({ ...t, changes: t.changes.map((c) => (c.id === changeId ? { ...c, review } : c)) }));
    },
    [patchTask],
  );

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setActiveTaskId((cur) => (cur === id ? null : cur));
  }, []);

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  const value: StoreValue = {
    ready,
    project,
    tasks,
    activeTask,
    activeTaskId,
    settings,
    environment,
    pendingApproval,
    drawer,
    isRunning,
    isLoadingProject,
    openProject,
    refreshProject,
    openDrawer: setDrawer,
    closeDrawer: () => setDrawer(null),
    selectTask: setActiveTaskId,
    updateSettings,
    runTask,
    stopRun,
    resolveApproval,
    reviewChange,
    deleteTask,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
