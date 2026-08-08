/**
 * Icarus Adapter
 *
 * Bridges the Icarus backend (SDK over WebSocket + REST at localhost:3000) to
 * the MarginAgent RunEvent stream that store.tsx already consumes.
 *
 * The adapter is an async generator: it yields RunEvents as they arrive from
 * the server and resolves when the run finishes (completed / failed / cancelled).
 * store.tsx drives the generator the same way it drives the demo script, so the
 * UI never needs to know which backend produced the events.
 */

import type { RunEvent } from "./runner";

// ─── Low-level REST helpers ───────────────────────────────────────────────────

export interface IcarusAdapterConfig {
  baseUrl: string; // e.g. "http://localhost:3000"
  token: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function apiFetch<T>(
  config: IcarusAdapterConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: authHeaders(config.token),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${config.baseUrl}${path}`, init);
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Health check ─────────────────────────────────────────────────────────────

export interface IcarusHealth {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export async function pingIcarus(config: IcarusAdapterConfig): Promise<IcarusHealth> {
  const t0 = Date.now();
  try {
    // GET /runs is auth-gated — a 200 confirms both reachability and token validity
    await apiFetch<unknown>(config, "GET", "/runs");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Event translation ────────────────────────────────────────────────────────
// (Stream chunks are batched inline in the generator instead of mapped here)

// ─── Run starter ──────────────────────────────────────────────────────────────

interface StartRunResponse {
  runId: string;
}

export async function startIcarusRun(
  config: IcarusAdapterConfig,
  goal: string,
  workspacePath?: string,
): Promise<string> {
  const res = await apiFetch<StartRunResponse>(config, "POST", "/run", { goal, workspacePath });
  return res.runId;
}

// ─── WebSocket event stream ───────────────────────────────────────────────────

interface WsEnvelope {
  runId?: string;
  type?: string;
  kind?: string;
  // event-specific payloads
  delta?: string;
  message?: string;
  toolName?: string;
  goal?: string;
  answer?: string;
  error?: string;
  approvalId?: string;
  summary?: string;
  graph?: { nodes: Array<{ status: string }> };
  timestamp?: number;
}

/**
 * Async generator that connects via WebSocket and yields RunEvents for one run.
 *
 * Resolves (returns) when the run terminal state is reached or the abort signal fires.
 * The caller (store.tsx) iterates with `for await` and pushes each event into state.
 */
export async function* icarusRunEvents(
  config: IcarusAdapterConfig,
  runId: string,
  signal: AbortSignal,
  // Approval callback: store gives us a resolver so we can await user decision
  requestApproval: (approvalId: string, summary: string) => Promise<boolean>,
): AsyncGenerator<RunEvent, void, unknown> {
  const wsUrl =
    config.baseUrl.replace(/^http/, "ws") +
    `/ws?token=${encodeURIComponent(config.token)}`;

  let ws: WebSocket;
  let resolveClose!: () => void;
  const closedPromise = new Promise<void>((r) => (resolveClose = r));

  // Buffer incoming messages so the generator can pull them
  const queue: WsEnvelope[] = [];
  let resolveNext: (() => void) | null = null;
  let wsError: Error | null = null;
  let done = false;

  const enqueue = (msg: WsEnvelope) => {
    queue.push(msg);
    resolveNext?.();
    resolveNext = null;
  };

  ws = new WebSocket(wsUrl);

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as WsEnvelope;
      enqueue(msg);
    } catch {
      // ignore non-JSON frames
    }
  };

  ws.onerror = () => {
    wsError = new Error("WebSocket connection error");
    resolveNext?.();
    resolveNext = null;
  };

  ws.onclose = () => {
    done = true;
    resolveNext?.();
    resolveNext = null;
    resolveClose();
  };

  signal.addEventListener("abort", () => {
    done = true;
    ws.close();
    resolveNext?.();
    resolveNext = null;
  });

  // Wait until WS is open before starting
  if (ws.readyState !== WebSocket.OPEN) {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket failed to connect"));
    });
  }

  // Stream chunks accumulator — we batch them into agent messages
  let streamBuffer = "";
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushStream = (): RunEvent | null => {
    if (!streamBuffer.trim()) return null;
    const text = streamBuffer;
    streamBuffer = "";
    return { t: "agent", text, ms: 0 };
  };

  try {
    while (!done && !signal.aborted) {
      if (wsError) throw wsError;

      // Pull next message (or wait for one)
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
          // Also resolve if WS closes
          closedPromise.then(resolve);
        });
      }

      if (queue.length === 0) continue;

      const msg = queue.shift()!;

      // Only handle events for our run (or broadcasts)
      if (msg.runId && msg.runId !== runId) continue;

      const kind = msg.kind ?? msg.type ?? "";

      switch (kind) {
        case "connected":
          break; // handshake

        case "agent.run.started":
          yield { t: "activity", kind: "understand", label: "Starting run…", ms: 0 };
          break;

        case "planner.started":
          yield {
            t: "activity",
            kind: "plan",
            label: "Planning",
            ...(msg.goal && { detail: msg.goal }),
            ms: 0,
          };
          break;

        case "planner.completed":
          yield {
            t: "activity",
            kind: "plan",
            label: "Plan ready",
            ms: 0,
          };
          break;

        case "agent.thinking":
          // Flush any buffered stream first
          if (streamBuffer) {
            const ev = flushStream();
            if (ev) yield ev;
          }
          const message = msg.message ?? "Thinking…";
          yield {
            t: "activity",
            kind: "understand",
            label: message.length > 80 ? message.slice(0, 80) + "…" : message,
            ...(msg.message && { detail: msg.message }),
            ms: 0,
          };
          break;

        case "tool.started":
          if (streamBuffer) {
            const ev = flushStream();
            if (ev) yield ev;
          }
          yield {
            t: "activity",
            kind: "search",
            label: msg.toolName ?? "Running tool",
            ms: 0,
          };
          break;

        case "tool.completed":
          yield {
            t: "tool",
            name: msg.toolName ?? "tool",
            text: msg.toolName ?? "Tool completed",
            result: "",
            ms: 0,
          };
          break;

        case "stream.chunk":
          streamBuffer += msg.delta ?? "";
          // Debounce: flush after 600ms of silence
          if (streamFlushTimer) clearTimeout(streamFlushTimer);
          streamFlushTimer = setTimeout(() => {
            // Will be flushed on next non-stream event or at completion
          }, 600);
          break;

        case "policy.approval.requested": {
          // Flush buffered stream before showing approval
          if (streamBuffer) {
            const ev = flushStream();
            if (ev) yield ev;
          }
          const approvalId = msg.approvalId ?? "";
          const summary = msg.summary ?? "Approval required";
          // Yield the approval event — store will pause and await user decision
          yield {
            t: "approval",
            ms: 0,
            approval: {
              kind: "command",
              title: "Agent action requires approval",
              description: summary,
              details: [],
            },
          };
          // Now wait for user decision (store resolves this via resolveApproval)
          const approved = await requestApproval(approvalId, summary);
          // Send decision to server
          try {
            const endpoint = approved ? "approve" : "reject";
            await apiFetch(config, "POST", `/runs/${runId}/${endpoint}`, { approvalId });
          } catch (e) {
            console.error("Failed to send approval decision", e);
          }
          break;
        }

        case "task.dispatched":
        case "task.completed": {
          // Update progress if graph is present
          if (msg.graph) {
            const nodes = msg.graph.nodes ?? [];
            const total = nodes.length;
            const completed = nodes.filter((n) => n.status === "Succeeded").length;
            if (total > 0) {
              yield {
                t: "activity",
                kind: "edit",
                label: `Tasks: ${completed}/${total}`,
                ms: 0,
              };
            }
          }
          break;
        }

        case "agent.run.completed": {
          if (streamBuffer) {
            const ev = flushStream();
            if (ev) yield ev;
          }
          const answer = msg.answer ?? "Run completed.";
          yield { t: "summary", text: answer, ms: 0 };
          done = true;
          break;
        }

        case "agent.error": {
          if (streamBuffer) {
            const ev = flushStream();
            if (ev) yield ev;
          }
          yield {
            t: "warning",
            text: `Agent error: ${msg.error ?? "Unknown error"}`,
            ms: 0,
          };
          yield {
            t: "summary",
            text: `Run failed: ${msg.error ?? "Unknown error"}`,
            ms: 0,
          };
          done = true;
          break;
        }
      }
    }

    // Final stream flush if we exited the loop cleanly
    if (streamBuffer) {
      const ev = flushStream();
      if (ev) yield ev;
    }
  } finally {
    if (streamFlushTimer) clearTimeout(streamFlushTimer);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

// ─── Connection config builder ────────────────────────────────────────────────

export function buildIcarusConfig(companionUrl: string, token: string): IcarusAdapterConfig {
  // Normalise: strip trailing slash, ensure http prefix
  let url = companionUrl.trim().replace(/\/$/, "");
  if (!url.startsWith("http")) url = "http://" + url;
  return { baseUrl: url, token };
}
