/**
 * Tauri Bridge
 *
 * Wraps Tauri's invoke() calls to provide the same interface
 * the rest of the app uses. When running in a browser (dev without Tauri),
 * falls back gracefully.
 */

import type { FileNode, Project } from "./types";

// Detect if we're running inside Tauri
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Lazy-load Tauri APIs so the app still bundles without them in browser mode
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Not running in Tauri");
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  const unlisten = await tauriListen<T>(event, (e) => handler(e.payload));
  return unlisten;
}

// ─── Folder picker ────────────────────────────────────────────────────────────

export async function pickFolder(): Promise<string | null> {
  return invoke<string | null>("pick_folder");
}

// ─── File system ──────────────────────────────────────────────────────────────

export interface RustFileNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: RustFileNode[];
  git_status?: string;
}

function mapNode(node: RustFileNode): FileNode {
  return {
    name: node.name,
    path: node.path,
    kind: node.kind,
    children: node.children?.map(mapNode),
    gitStatus: node.git_status as FileNode["gitStatus"],
  };
}

export async function readDirTree(root: string): Promise<FileNode[]> {
  const nodes = await invoke<RustFileNode[]>("read_dir_tree", { root });
  return nodes.map(mapNode);
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

export interface CommandResult {
  output: string;
  exit_code: number;
  success: boolean;
}

export async function runCommand(command: string, cwd: string): Promise<CommandResult> {
  return invoke<CommandResult>("run_command", { command, cwd });
}

// ─── Codebase Memory MCP ─────────────────────────────────────────────────────

export interface CbmIndexStatus {
  indexed: boolean;
  project: string | null;
  node_count: number | null;
  edge_count: number | null;
  status: string;
}

export async function cbmIndex(repoPath: string): Promise<CbmIndexStatus> {
  return invoke<CbmIndexStatus>("cbm_index", { repoPath });
}

export async function cbmSearch(project: string, query: string, limit = 20): Promise<unknown> {
  return invoke("cbm_search", { project, query, limit });
}

export async function cbmSemanticSearch(project: string, query: string, limit = 10): Promise<unknown> {
  return invoke("cbm_semantic_search", { project, query, limit });
}

export async function cbmTrace(project: string, functionName: string, direction = "both", depth = 3): Promise<unknown> {
  return invoke("cbm_trace", { project, functionName, direction, depth });
}

export async function cbmArchitecture(project: string): Promise<unknown> {
  return invoke("cbm_architecture", { project });
}

export async function cbmGetCode(project: string, qualifiedName: string): Promise<unknown> {
  return invoke("cbm_get_code", { project, qualifiedName });
}

export async function cbmDetectChanges(project: string): Promise<unknown> {
  return invoke("cbm_detect_changes", { project });
}

export async function cbmStartUi(): Promise<string> {
  return invoke<string>("cbm_start_ui");
}

export async function cbmUiStatus(): Promise<boolean> {
  return invoke<boolean>("cbm_ui_status");
}

export interface LlmCallResponse {
  content: string | null;
  tool_calls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> | null;
}

export async function llmCall(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: unknown[],
  temperature: number,
  tools: unknown[],
): Promise<LlmCallResponse> {
  return invoke<LlmCallResponse>("llm_call", {
    request: {
      base_url: baseUrl,
      api_key: apiKey ?? null,
      model,
      messages,
      temperature,
      tools: tools.length > 0 ? tools : null,
    },
  });
}

export async function fileSearch(
  root: string,
  query: string,
): Promise<Array<{ path: string; line: number; preview: string }>> {
  return invoke("file_search", { root, query });
}

// ─── Git ─────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  dirty_files: number;
  ahead: number;
  repository: string;
  files: Array<{ path: string; status: string }>;
}

export async function gitStatus(workspace: string): Promise<GitStatus | null> {
  try {
    return await invoke<GitStatus>("git_status", { workspace });
  } catch {
    // Not a git repo — that's fine
    return null;
  }
}

// ─── LLM streaming ────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

let streamCounter = 0;

/**
 * Stream a chat completion via Tauri's Rust backend.
 * Returns an async generator that yields text deltas.
 */
export async function* streamLlm(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: LlmMessage[],
  temperature: number,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const streamEvent = `llm-stream-${++streamCounter}`;

  const chunks: string[] = [];
  let done = false;
  let resolve: (() => void) | null = null;

  const unlisten = await listen<StreamChunk>(streamEvent, (chunk) => {
    if (chunk.done) {
      done = true;
    } else {
      chunks.push(chunk.delta);
    }
    resolve?.();
    resolve = null;
  });

  signal.addEventListener("abort", () => {
    done = true;
    resolve?.();
    resolve = null;
  });

  // Start the Rust-side stream (runs async in background)
  const invokePromise = invoke("llm_complete", {
    request: {
      base_url: baseUrl,
      api_key: apiKey ?? null,
      model,
      messages,
      temperature,
      stream_event: streamEvent,
    },
  }).catch(() => {
    done = true;
    resolve?.();
    resolve = null;
  });

  try {
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else if (!done) {
        await new Promise<void>((r) => { resolve = r; });
      }
    }
  } finally {
    unlisten();
    await invokePromise;
  }
}

// ─── Project loader ───────────────────────────────────────────────────────────

/**
 * Load a full project from a workspace path:
 * reads the file tree, git status, and returns a Project object.
 */
export async function loadProject(workspacePath: string): Promise<Project> {
  const name = workspacePath.split(/[/\\]/).pop() ?? workspacePath;

  const [tree, git] = await Promise.all([
    readDirTree(workspacePath),
    gitStatus(workspacePath),
  ]);

  // Overlay git statuses onto tree nodes
  if (git?.files.length) {
    overlayGitStatus(tree, git.files);
  }

  return {
    id: workspacePath,
    name,
    workspacePath,
    branch: git?.branch ?? "main",
    repository: git?.repository ?? name,
    dirtyFiles: git?.dirty_files ?? 0,
    ahead: git?.ahead ?? 0,
    instructions: "",
    demo: false,
    tree,
  };
}

function overlayGitStatus(
  nodes: FileNode[],
  files: Array<{ path: string; status: string }>,
): void {
  const statusMap = new Map(files.map((f) => [f.path.replace(/\\/g, "/"), f.status]));

  function walk(node: FileNode) {
    const normalised = node.path.replace(/\\/g, "/");
    const s = statusMap.get(normalised);
    if (s) {
      node.gitStatus = s as FileNode["gitStatus"];
    }
    node.children?.forEach(walk);
  }

  nodes.forEach(walk);
}
