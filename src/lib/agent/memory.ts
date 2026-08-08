/**
 * Persistent memory for MarginAgent.
 *
 * Two layers:
 * 1. Project memory — key decisions, patterns, constraints discovered over time.
 *    Persisted to localStorage keyed by project path.
 * 2. Conversation context — last N task summaries injected into every prompt
 *    so the LLM remembers what was recently done.
 */

import type { Task } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  kind: "decision" | "pattern" | "constraint" | "fact";
  text: string;
  addedAt: number;
  taskId?: string;
}

export interface ProjectMemory {
  projectId: string;
  entries: MemoryEntry[];
  updatedAt: number;
}

export interface TaskSummary {
  taskId: string;
  title: string;
  prompt: string;
  outcome: string; // last summary message text
  filesChanged: string[];
  commandsRun: string[];
  completedAt: number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const MEMORY_KEY_PREFIX = "marginagent.memory.";
const HISTORY_KEY_PREFIX = "marginagent.history.";

function memoryKey(projectId: string) {
  return `${MEMORY_KEY_PREFIX}${projectId.replace(/[^a-z0-9]/gi, "_")}`;
}

function historyKey(projectId: string) {
  return `${HISTORY_KEY_PREFIX}${projectId.replace(/[^a-z0-9]/gi, "_")}`;
}

export function loadProjectMemory(projectId: string): ProjectMemory {
  try {
    const raw = localStorage.getItem(memoryKey(projectId));
    if (!raw) return { projectId, entries: [], updatedAt: 0 };
    return JSON.parse(raw) as ProjectMemory;
  } catch {
    return { projectId, entries: [], updatedAt: 0 };
  }
}

export function saveProjectMemory(memory: ProjectMemory): void {
  try {
    localStorage.setItem(memoryKey(memory.projectId), JSON.stringify(memory));
  } catch { /* storage full — ignore */ }
}

export function addMemoryEntry(
  projectId: string,
  kind: MemoryEntry["kind"],
  text: string,
  taskId?: string,
): void {
  const memory = loadProjectMemory(projectId);
  const entry: MemoryEntry = {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    text,
    addedAt: Date.now(),
    taskId,
  };
  // Deduplicate — don't add identical text
  if (memory.entries.some((e) => e.text === text)) return;
  // Cap at 50 entries per project
  memory.entries = [entry, ...memory.entries].slice(0, 50);
  memory.updatedAt = Date.now();
  saveProjectMemory(memory);
}

export function clearProjectMemory(projectId: string): void {
  localStorage.removeItem(memoryKey(projectId));
}

// ─── Task history ─────────────────────────────────────────────────────────────

export function loadTaskHistory(projectId: string): TaskSummary[] {
  try {
    const raw = localStorage.getItem(historyKey(projectId));
    if (!raw) return [];
    return JSON.parse(raw) as TaskSummary[];
  } catch {
    return [];
  }
}

export function saveTaskToHistory(projectId: string, task: Task): void {
  if (task.status !== "complete") return;

  const summaryMsg = [...task.messages].reverse().find((m) => m.role === "summary");
  if (!summaryMsg) return;

  const summary: TaskSummary = {
    taskId: task.id,
    title: task.title,
    prompt: task.prompt,
    outcome: summaryMsg.text,
    filesChanged: task.changes.map((c) => c.path),
    commandsRun: task.terminal.map((t) => t.command),
    completedAt: task.updatedAt,
  };

  const history = loadTaskHistory(projectId);
  // Avoid duplicates
  const filtered = history.filter((h) => h.taskId !== task.id);
  // Keep last 20 tasks
  const updated = [summary, ...filtered].slice(0, 20);

  try {
    localStorage.setItem(historyKey(projectId), JSON.stringify(updated));
  } catch { /* ignore */ }
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build the full memory context string to inject into the system prompt.
 * Includes:
 * - Project file list (from Project.tree)
 * - Persistent memory entries (decisions, patterns, constraints)
 * - Recent task history (last 5 completed tasks)
 */
export function buildMemoryContext(
  projectId: string,
  workspacePath: string,
  branch: string,
  fileList: string[],
): string {
  const parts: string[] = [];

  // File context
  const files = fileList.slice(0, 80).join("\n");
  parts.push(`Workspace: ${workspacePath}\nBranch: ${branch}\nFiles:\n${files}${fileList.length > 80 ? `\n… and ${fileList.length - 80} more` : ""}`);

  // Memory entries
  const memory = loadProjectMemory(projectId);
  if (memory.entries.length > 0) {
    const grouped = {
      decision: memory.entries.filter((e) => e.kind === "decision"),
      pattern: memory.entries.filter((e) => e.kind === "pattern"),
      constraint: memory.entries.filter((e) => e.kind === "constraint"),
      fact: memory.entries.filter((e) => e.kind === "fact"),
    };

    const memLines: string[] = [];
    if (grouped.decision.length > 0) {
      memLines.push("Decisions made:");
      grouped.decision.forEach((e) => memLines.push(`  - ${e.text}`));
    }
    if (grouped.pattern.length > 0) {
      memLines.push("Coding patterns in this project:");
      grouped.pattern.forEach((e) => memLines.push(`  - ${e.text}`));
    }
    if (grouped.constraint.length > 0) {
      memLines.push("Constraints:");
      grouped.constraint.forEach((e) => memLines.push(`  - ${e.text}`));
    }
    if (grouped.fact.length > 0) {
      memLines.push("Known facts:");
      grouped.fact.forEach((e) => memLines.push(`  - ${e.text}`));
    }

    if (memLines.length > 0) {
      parts.push("Project memory:\n" + memLines.join("\n"));
    }
  }

  // Recent task history
  const history = loadTaskHistory(projectId);
  if (history.length > 0) {
    const recent = history.slice(0, 5);
    const histLines = recent.map((h) => {
      const files = h.filesChanged.length > 0 ? ` (changed: ${h.filesChanged.slice(0, 3).join(", ")})` : "";
      return `  - "${h.title}"${files}: ${h.outcome.slice(0, 120)}${h.outcome.length > 120 ? "…" : ""}`;
    });
    parts.push("Recent task history:\n" + histLines.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Build conversation history from recent completed tasks.
 * Returns messages in OpenAI format to prepend to the current conversation.
 */
export function buildConversationHistory(
  projectId: string,
  currentTaskId: string,
  allTasks: Task[],
  maxTasks = 3,
): Array<{ role: "user" | "assistant"; content: string }> {
  const recentCompleted = allTasks
    .filter((t) => t.id !== currentTaskId && t.status === "complete")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxTasks);

  if (recentCompleted.length === 0) return [];

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const task of [...recentCompleted].reverse()) {
    // User message
    history.push({ role: "user", content: task.prompt });

    // Build a compact assistant summary
    const agentMsgs = task.messages.filter((m) => m.role === "agent" || m.role === "summary");
    const summaryMsg = task.messages.findLast((m) => m.role === "summary");
    const agentMsg = task.messages.find((m) => m.role === "agent");

    let response = "";
    if (agentMsg) response += agentMsg.text.slice(0, 500) + (agentMsg.text.length > 500 ? "…" : "");
    if (summaryMsg && summaryMsg !== agentMsg) {
      if (response) response += "\n\n";
      response += summaryMsg.text;
    }
    if (task.changes.length > 0) {
      response += `\n\nFiles changed: ${task.changes.map((c) => c.path).join(", ")}`;
    }

    if (response) {
      history.push({ role: "assistant", content: response });
    }
  }

  return history;
}

// ─── Auto-extract memory from completed tasks ─────────────────────────────────

/**
 * After a task completes, extract memorable facts from the conversation
 * and persist them to project memory.
 */
export function extractAndSaveMemory(projectId: string, task: Task): void {
  if (task.status !== "complete") return;

  // Extract file patterns from changes
  for (const change of task.changes) {
    const ext = change.path.split(".").pop() ?? "";
    const dir = change.path.split("/").slice(0, -1).join("/");
    if (dir && ext) {
      addMemoryEntry(projectId, "pattern", `${ext} files live in ${dir}`, task.id);
    }
  }

  // Extract commands that succeeded as facts
  for (const exec of task.terminal) {
    if (exec.status === "success" && exec.command.startsWith("npm ")) {
      addMemoryEntry(projectId, "fact", `Project uses npm (${exec.command})`, task.id);
    }
  }

  // Save to history
  saveTaskToHistory(projectId, task);
}
