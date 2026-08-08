/**
 * Clean API layer between the MarginAgent frontend and the local companion
 * service running on the user's machine.
 *
 * The frontend never touches a filesystem itself. Every capability below is a
 * request to the companion service, which owns workspace sandboxing, command
 * allow-lists, timeouts, output limits and the audit log.
 *
 * Until a companion is connected the app stays in Demo Mode and NEVER
 * fabricates real filesystem, terminal, git or test results.
 */

import type { FileNode, Problem, TerminalExecution, TestRun } from "./types";

export interface CompanionHealth {
  ok: boolean;
  version?: string | undefined;
  workspacePath?: string | undefined;
  latencyMs?: number | undefined;
  error?: string | undefined;
}

export interface CompanionCapabilities {
  listFiles(): Promise<FileNode[]>;
  readFile(path: string): Promise<string>;
  search(query: string): Promise<{ path: string; line: number; preview: string }[]>;
  writeFile(path: string, content: string): Promise<void>;
  runCommand(command: string): Promise<TerminalExecution>;
  gitStatus(): Promise<{ branch: string; files: { path: string; status: string }[] }>;
  runTests(command: string): Promise<TestRun>;
  problems(): Promise<Problem[]>;
}

const DEFAULT_TIMEOUT_MS = 8000;

export class CompanionClient implements CompanionCapabilities {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`Companion responded ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<CompanionHealth> {
    const started = Date.now();
    try {
      const data = await this.request<{ version: string; workspacePath?: string }>("/health");
      return {
        ok: true,
        version: data.version,
        workspacePath: data.workspacePath,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not reach the local companion",
      };
    }
  }

  listFiles() {
    return this.request<FileNode[]>("/fs/list");
  }

  readFile(path: string) {
    return this.request<{ content: string }>(
      `/fs/read?path=${encodeURIComponent(path)}`,
    ).then((r) => r.content);
  }

  search(query: string) {
    return this.request<{ path: string; line: number; preview: string }[]>(
      `/fs/search?q=${encodeURIComponent(query)}`,
    );
  }

  writeFile(path: string, content: string) {
    return this.request<void>("/fs/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  }

  runCommand(command: string) {
    return this.request<TerminalExecution>("/exec/run", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  }

  gitStatus() {
    return this.request<{ branch: string; files: { path: string; status: string }[] }>(
      "/git/status",
    );
  }

  runTests(command: string) {
    return this.request<TestRun>("/tests/run", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  }

  problems() {
    return this.request<Problem[]>("/diagnostics");
  }
}

export async function checkCompanion(baseUrl: string): Promise<CompanionHealth> {
  if (!baseUrl.trim()) return { ok: false, error: "No local service URL configured" };
  return new CompanionClient(baseUrl).health();
}
