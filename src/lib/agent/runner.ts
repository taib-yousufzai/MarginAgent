/**
 * LLM runner with agentic tool-calling loop.
 *
 * - ask / plan  → single-shot, no tools
 * - edit        → single-shot with read tools only
 * - agent       → full loop: read, write, search, run commands
 *
 * Uses Tauri's Rust backend for all file/command operations (no CORS, no
 * Node.js required). Falls back to browser fetch for the LLM stream.
 */

import type { AgentMode, Settings, StepKind, Approval, FileChange, Problem, TerminalExecution, TestRun } from "./types";
import {
  isTauri, streamLlm, llmCall,
  readFile, writeFile, runCommand, fileSearch,
  cbmSearch, cbmSemanticSearch, cbmTrace, cbmArchitecture, cbmGetCode,
} from "./tauri-bridge";
import { buildSkillsPrompt } from "../skills";

// ─── RunEvent ────────────────────────────────────────────────────────────────

export type RunEvent =
  | { t: "activity"; kind: StepKind; label: string; detail?: string; ms: number }
  | { t: "thinking"; text: string; ms: number }
  | { t: "agent";   text: string; ms: number }
  | { t: "plan";    text: string; items: string[]; ms: number }
  | { t: "tool";    name: string; text: string; result: string; ms: number }
  | { t: "approval"; approval: Omit<Approval, "id" | "status" | "at">; ms: number }
  | { t: "changes"; changes: Omit<FileChange, "id" | "review">[]; ms: number }
  | { t: "terminal"; exec: Omit<TerminalExecution, "id" | "at">; ms: number }
  | { t: "tests";   run: Omit<TestRun, "id" | "at">; ms: number }
  | { t: "problems"; problems: Omit<Problem, "id">[]; ms: number }
  | { t: "warning"; text: string; ms: number }
  | { t: "summary"; text: string; ms: number };

// ─── Tool definitions ─────────────────────────────────────────────────────────

const READ_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full text content of a file from disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern across the project. Returns matching file paths, line numbers, and previews.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for." },
        },
        required: ["query"],
      },
    },
  },
];

const WRITE_TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write (or overwrite) a file with new content. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path:    { type: "string", description: "Absolute path to the file." },
          content: { type: "string", description: "Full new content for the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the project workspace. Use for: npm install, npm run build, npm test, git commands, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute." },
        },
        required: ["command"],
      },
    },
  },
];

// CBM tools — only added when running in Tauri (binary available)
const CBM_TOOLS = [
  {
    type: "function",
    function: {
      name: "cbm_semantic_search",
      description: "Semantic vector search across the codebase knowledge graph. Better than text search for conceptual queries like 'authentication logic' or 'error handling'. Returns matching functions, classes, and files ranked by relevance.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language description of what to find." },
          limit: { type: "number", description: "Max results (default 10)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cbm_search",
      description: "Structural graph search by name pattern. Use for finding specific functions, classes, or methods by name. Faster than semantic_search for exact/partial name lookups.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name pattern to search for (partial match)." },
          limit: { type: "number", description: "Max results (default 20)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cbm_trace",
      description: "Trace call paths for a function — who calls it and what it calls. Essential for impact analysis before making changes.",
      parameters: {
        type: "object",
        properties: {
          function_name: { type: "string", description: "Function name to trace." },
          direction: { type: "string", enum: ["inbound", "outbound", "both"], description: "Trace direction (default: both)." },
          depth: { type: "number", description: "Traversal depth 1-5 (default: 3)." },
        },
        required: ["function_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cbm_architecture",
      description: "Get a high-level architecture overview: languages, packages, entry points, API routes, hotspot files, and module clusters. Run this first when exploring an unfamiliar codebase.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cbm_get_code",
      description: "Get the source code of a specific function or class by its qualified name (project.path.FunctionName). Use cbm_search first to find the qualified name.",
      parameters: {
        type: "object",
        properties: {
          qualified_name: { type: "string", description: "Qualified name like 'myproject.src.utils.parseDate'." },
        },
        required: ["qualified_name"],
      },
    },
  },
];

// ─── Permanent rules (always injected) ───────────────────────────────────────

const PONYTAIL_RULE = `# Ponytail — lazy senior dev mode

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:
1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem — read the task and trace the real flow end to end, then climb.

Bug fix = root cause, not symptom. Grep every caller of the function you touch and fix the shared function once.

Rules:
- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- Mark deliberate simplifications with a \`ponytail:\` comment naming the ceiling and upgrade path.

Not lazy about: input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested.`;

const FABLE_RULE = `# The Fable Method — think, act, prove

A mid-tier model that follows this loop beats a stronger model that free-styles. The quality lives in structure, evidence, and honesty. Follow this literally. Do NOT narrate step numbers in your output — steps structure your work, not your responses.

**Triviality gate (run first).** Trivial only if ALL true: one file, <10 changed lines, no new behavior, you already know exactly what to change. If trivial: change it, confirm with the obvious check, report in 1-2 sentences. Everything else gets the full loop.

**Step 0 — Classify the ask:**
- Question/assessment ("why is...", "what do you think...") → findings + recommendation, change nothing
- Task ("fix", "build", "change") → completed change, verified
- Plan-first (ambiguous scope, irreversible actions, or user asks for a plan) → plan with recommendation, stop for approval
- Tie-break: plan-first beats task when any plan-first signal is present

**Step 1 — Define done:** State the named verification before acting. "Done when: [specific observable outcome]." If you cannot name a verification, ask one pointed question.

**Step 2 — Gather evidence:** Read primary sources (files, specs, tests, docs). Never act on assumptions. Budget: 2 fruitless lookups → stop searching. Parallel where possible.

**Step 3 — Decide:** Commit to ONE recommendation. State it. Never hedge with "you could also...".

**Step 4 — Act surgically:** Change the smallest correct thing. Touch only what the task requires. Checklist your changes.

**Step 5 — Verify by observation:** Run the named verification from Step 1. Bounded retries: 3 failed verify cycles → stop and hand back. Never claim done without observed evidence.

**Step 6 — Report outcome first:** Lead with what happened, then how, then caveats. Honest about what was not verified. Never claim success you did not observe.`;

const KARPATHY_RULE = `# Karpathy Guidelines — coding discipline

**1. Think before coding.** State assumptions explicitly. If uncertain, ask. Present tradeoffs before picking one silently.

**2. Simplicity first.** Write the minimum code that solves the problem. No speculative features. No premature abstractions. No "flexibility" nobody asked for. If you write 200 lines and it could be 50, rewrite it.

**3. Surgical changes.** Touch only what you must. Don't improve adjacent code. Match existing style. Every changed line must trace directly to the user's request. Remove only imports/variables YOUR changes made unused — not pre-existing dead code.

**4. Goal-driven execution.** Transform tasks into verifiable goals before starting: "Fix the bug" → "Write a test that reproduces it, then make it pass." Define success criteria that let you loop independently.`;

const CONTEXT7_RULE = `# Context7 — use actual docs, not training data

Before implementing anything using a library, framework, or API:
1. Check the exact version installed (package.json, Cargo.toml, pyproject.toml, etc.)
2. Do NOT assume API shape from training data — APIs change between versions
3. Read the actual source: installed node_modules, vendor dir, or source files to verify real signatures
4. Never hallucinate function signatures — if unsure, read the source
5. Flag version mismatches — if the installed version has known breaking changes vs your training, say so
6. Always name the specific function/type/hook and where it comes from`;

const TASK_OBSERVER_RULE = `# Task Observer — track every sub-task

For any multi-step task:

Before starting: break the request into numbered sub-tasks and state them: "1. [...] 2. [...] 3. [...]"

During: mark each complete as you finish it (✓ 1. Done). If a sub-task reveals new work, add it. If blocked, say why.

After: list everything completed, everything NOT completed and why, and any follow-up the user should know about.

Never silently skip a task. Never mark something complete if it isn't. Never batch-complete at the end.`;

const ALL_RULES = [
  PONYTAIL_RULE,
  FABLE_RULE,
  KARPATHY_RULE,
  CONTEXT7_RULE,
  TASK_OBSERVER_RULE,
].join("\n\n---\n\n");

// ─── System prompts ───────────────────────────────────────────────────────────

function systemPrompt(mode: AgentMode, projectContext?: string, activeSkills: string[] = []): string {
  const ctx = projectContext ? `\n\n${projectContext}` : "";
  const skills = buildSkillsPrompt(activeSkills);

  if (mode === "ask") return `${ALL_RULES}\n\nYou are a software engineering assistant. Answer questions about code clearly and concisely. Do NOT modify files — only explain, analyze, and answer.${ctx}${skills}`;
  if (mode === "plan") return `${ALL_RULES}\n\nYou are a software engineering assistant. Analyze the request and produce a clear, numbered step-by-step plan. Be specific about which files change and why. Do NOT write code.${ctx}${skills}`;
  if (mode === "edit") return `${ALL_RULES}\n\nYou are a software engineering assistant with read access to the project. You can read files to understand the code, then provide precise edit instructions. Use read_file and search_files to understand the codebase before responding.${ctx}${skills}`;

  // agent mode — full agentic
  return `${ALL_RULES}\n\nYou are an autonomous software engineering agent with full access to the project filesystem. You MUST use tools to actually read and modify files — do NOT give instructions to the user, just do the work yourself.

Rules:
- ALWAYS use read_file before modifying any file so you have the current content.
- Use search_files to locate relevant files before reading them.
- Use write_file to apply every change — write the COMPLETE new file content, not diffs.
- Use run_command to install packages, run tests, build, etc.
- After making all changes, summarize what you did concisely.
- Never ask the user to run commands — run them yourself.
- If a file doesn't need to change, don't write it.${ctx}${skills}`;
}

// ─── Non-streaming call (routes through Rust to avoid CORS) ──────────────────

async function callLlm(
  settings: Settings,
  messages: unknown[],
  tools: unknown[],
  signal: AbortSignal,
): Promise<{ content: string | null; tool_calls: ToolCall[] | null }> {
  // In Tauri: use Rust backend — no CORS, no webview restrictions
  if (isTauri) {
    const res = await llmCall(
      settings.baseUrl,
      settings.apiKey || undefined,
      settings.modelId,
      messages,
      settings.temperature,
      tools,
    );
    return {
      content: res.content,
      tool_calls: res.tool_calls as ToolCall[] | null,
    };
  }

  // Browser fallback
  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  const body: Record<string, unknown> = {
    model: settings.modelId,
    messages,
    temperature: settings.temperature,
    stream: false,
  };
  if (tools.length > 0) body["tools"] = tools;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", headers, signal,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`LLM API error: ${err}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content?: string | null; tool_calls?: ToolCall[] } }>;
  };
  const msg = json.choices[0]?.message;
  return { content: msg?.content ?? null, tool_calls: msg?.tool_calls ?? null };
}

// ─── Streaming call (routes through Rust to avoid CORS) ──────────────────────

async function* streamingCall(
  settings: Settings,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): AsyncGenerator<{ type: "thinking" | "text"; chunk: string }> {
  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", headers, signal,
    body: JSON.stringify({
      model: settings.modelId,
      messages,
      temperature: settings.temperature,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`LLM API error: ${err}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === "data: [DONE]" || !t.startsWith("data: ")) continue;
        try {
          const j = JSON.parse(t.slice(6));
          const choice = j?.choices?.[0];
          // reasoning_content field (DeepSeek, some OpenRouter models)
          const reasoning = choice?.delta?.reasoning_content;
          if (reasoning) yield { type: "thinking", chunk: reasoning };
          // Normal content delta
          const delta = choice?.delta?.content;
          if (delta) yield { type: "text", chunk: delta };
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, string>,
  workspacePath: string,
): Promise<{ result: string; event?: RunEvent }> {
  switch (name) {
    case "read_file": {
      try {
        const content = await readFile(args["path"]!);
        const preview = content.length > 200
          ? content.slice(0, 200) + `\n… (${content.length} chars total)`
          : content;
        return {
          result: content,
          event: { t: "activity", kind: "read", label: `Read ${args["path"]!.split(/[/\\]/).pop()}`, detail: preview, ms: 0 },
        };
      } catch (e) {
        return { result: `Error reading file: ${e}` };
      }
    }

    case "search_files": {
      try {
        const results = await fileSearch(workspacePath, args["query"]!);
        const text = results.length === 0
          ? "No matches found."
          : results.map((r) => `${r.path}:${r.line} — ${r.preview}`).join("\n");
        return {
          result: text,
          event: { t: "activity", kind: "search", label: `Searching "${args["query"]}"`, detail: `${results.length} results`, ms: 0 },
        };
      } catch (e) {
        return { result: `Search error: ${e}` };
      }
    }

    case "write_file": {
      try {
        const path = args["path"]!;
        const content = args["content"]!;
        // Read old content for diff display
        let before = "";
        try { before = await readFile(path); } catch { /* new file */ }

        await writeFile(path, content);

        const additions = content.split("\n").filter((l) => !before.split("\n").includes(l)).length;
        const deletions = before.split("\n").filter((l) => !content.split("\n").includes(l)).length;

        return {
          result: `Written successfully.`,
          event: {
            t: "changes",
            ms: 0,
            changes: [{
              path,
              status: before ? "modified" : "added",
              before,
              after: content,
              additions,
              deletions,
            }],
          },
        };
      } catch (e) {
        return { result: `Error writing file: ${e}` };
      }
    }

    case "run_command": {
      try {
        const cmd = args["command"]!;
        const result = await runCommand(cmd, workspacePath);
        return {
          result: result.output || "(no output)",
          event: {
            t: "terminal",
            ms: 0,
            exec: {
              command: cmd,
              cwd: workspacePath,
              output: result.output,
              exitCode: result.exit_code,
              status: result.success ? "success" : "failed",
            },
          },
        };
      } catch (e) {
        return { result: `Command error: ${e}` };
      }
    }

    // ── CBM tools ─────────────────────────────────────────────────────────────

    case "cbm_semantic_search": {
      try {
        const projectName = workspacePath.split(/[/\\]/).pop() ?? "project";
        const result = await cbmSemanticSearch(projectName, args["query"]!, args["limit"] ? Number(args["limit"]) : 10);
        const text = JSON.stringify(result, null, 2);
        return {
          result: text,
          event: { t: "activity", kind: "search", label: `Semantic search: "${args["query"]}"`, detail: `CBM graph query`, ms: 0 },
        };
      } catch (e) {
        // CBM might not be indexed yet — fall back gracefully
        return { result: `CBM semantic search unavailable (project may not be indexed): ${e}. Use search_files instead.` };
      }
    }

    case "cbm_search": {
      try {
        const projectName = workspacePath.split(/[/\\]/).pop() ?? "project";
        const result = await cbmSearch(projectName, args["query"]!, args["limit"] ? Number(args["limit"]) : 20);
        const text = JSON.stringify(result, null, 2);
        return {
          result: text,
          event: { t: "activity", kind: "search", label: `Graph search: "${args["query"]}"`, ms: 0 },
        };
      } catch (e) {
        return { result: `CBM search unavailable: ${e}. Use search_files instead.` };
      }
    }

    case "cbm_trace": {
      try {
        const projectName = workspacePath.split(/[/\\]/).pop() ?? "project";
        const result = await cbmTrace(
          projectName,
          args["function_name"]!,
          args["direction"] ?? "both",
          args["depth"] ? Number(args["depth"]) : 3,
        );
        return {
          result: JSON.stringify(result, null, 2),
          event: { t: "activity", kind: "read", label: `Tracing calls for ${args["function_name"]}`, ms: 0 },
        };
      } catch (e) {
        return { result: `CBM trace unavailable: ${e}` };
      }
    }

    case "cbm_architecture": {
      try {
        const projectName = workspacePath.split(/[/\\]/).pop() ?? "project";
        const result = await cbmArchitecture(projectName);
        return {
          result: JSON.stringify(result, null, 2),
          event: { t: "activity", kind: "understand", label: "Reading codebase architecture", ms: 0 },
        };
      } catch (e) {
        return { result: `CBM architecture unavailable: ${e}` };
      }
    }

    case "cbm_get_code": {
      try {
        const projectName = workspacePath.split(/[/\\]/).pop() ?? "project";
        const result = await cbmGetCode(projectName, args["qualified_name"]!);
        return {
          result: JSON.stringify(result, null, 2),
          event: { t: "activity", kind: "read", label: `Get code: ${args["qualified_name"]}`, ms: 0 },
        };
      } catch (e) {
        return { result: `CBM get_code unavailable: ${e}` };
      }
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

// ─── Main run generator ───────────────────────────────────────────────────────

export async function* realRun(
  prompt: string,
  mode: AgentMode,
  settings: Settings,
  signal: AbortSignal,
  projectContext?: string,
  workspacePath?: string,
): AsyncGenerator<RunEvent, void, unknown> {

  // ── Non-agent modes: single shot ──────────────────────────────────────────
  if (mode === "ask" || mode === "plan") {
    yield { t: "activity", kind: "understand", label: "Thinking…", ms: 0 };
    const messages = [
      { role: "system", content: systemPrompt(mode, projectContext, settings.activeSkills) },
      { role: "user", content: prompt },
    ];
    let thinkingText = "";
    let responseText = "";
    let inThinkTag = false;

    try {
      for await (const chunk of streamingCall(settings, messages, signal)) {
        if (signal.aborted) return;
        if (chunk.type === "thinking") {
          thinkingText += chunk.chunk;
        } else {
          // Also parse inline <think>...</think> tags
          let text = chunk.chunk;
          if (!inThinkTag && text.includes("<think>")) {
            const parts = text.split("<think>");
            responseText += parts[0] ?? "";
            thinkingText += parts[1] ?? "";
            inThinkTag = true;
          } else if (inThinkTag && text.includes("</think>")) {
            const parts = text.split("</think>");
            thinkingText += parts[0] ?? "";
            responseText += parts[1] ?? "";
            inThinkTag = false;
          } else if (inThinkTag) {
            thinkingText += text;
          } else {
            responseText += text;
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }

    if (!responseText.trim() && !thinkingText.trim()) {
      yield { t: "warning", text: "Empty response. Check your API key and model in Settings.", ms: 0 };
      yield { t: "summary", text: "No response received.", ms: 0 };
      return;
    }

    // Emit thinking block first if we got any
    if (thinkingText.trim()) {
      yield { t: "thinking", text: thinkingText.trim(), ms: 0 };
    }

    if (responseText.trim()) {
      yield { t: "agent", text: responseText.trim(), ms: 0 };
    }
    yield { t: "summary", text: mode === "ask" ? "Answered." : "Plan ready. Switch to Agent mode to execute.", ms: 0 };
    return;
  }

  // ── Edit / Agent modes: tool-calling loop ─────────────────────────────────
  const tools = mode === "agent"
    ? [...READ_TOOLS, ...WRITE_TOOLS, ...(isTauri ? CBM_TOOLS : [])]
    : [...READ_TOOLS, ...(isTauri ? CBM_TOOLS : [])];
  const MAX_STEPS = settings.maxSteps ?? 24;

  const messages: unknown[] = [
    { role: "system", content: systemPrompt(mode, projectContext, settings.activeSkills) },
    { role: "user", content: prompt },
  ];

  yield { t: "activity", kind: "understand", label: "Analyzing request…", ms: 0 };

  let steps = 0;

  while (steps < MAX_STEPS && !signal.aborted) {
    steps++;

    let response: { content: string | null; tool_calls: ToolCall[] | null };
    try {
      response = await callLlm(settings, messages as Array<{ role: string; content: string }>, tools, signal);
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }

    // ── Tool calls → execute them ──────────────────────────────────────────
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Add assistant message with tool calls
      messages.push({ role: "assistant", content: response.content ?? null, tool_calls: response.tool_calls });

      for (const call of response.tool_calls) {
        if (signal.aborted) return;

        let args: Record<string, string> = {};
        try { args = JSON.parse(call.function.arguments) as Record<string, string>; } catch { /* empty */ }

        const { result, event } = await executeTool(
          call.function.name,
          args,
          workspacePath ?? "",
        );

        // Emit UI event for this tool call
        if (event) {
          yield event;
        } else {
          yield { t: "activity", kind: "search", label: `${call.function.name}(${Object.values(args).join(", ").slice(0, 40)})`, ms: 0 };
        }

        // Add tool result back to messages
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result,
        });
      }

      // Continue loop — LLM will respond to tool results
      continue;
    }

    // ── No tool calls → final text response ───────────────────────────────
    const finalText = response.content ?? "";
    if (finalText.trim()) {
      yield { t: "agent", text: finalText, ms: 0 };
    }

    yield {
      t: "summary",
      text: mode === "edit"
        ? "Analysis complete. Review the file contents above."
        : `Done in ${steps} step${steps === 1 ? "" : "s"}.`,
      ms: 0,
    };
    return;
  }

  if (signal.aborted) return;

  // Hit step limit
  yield { t: "warning", text: `Reached the ${MAX_STEPS}-step limit. The task may be incomplete.`, ms: 0 };
  yield { t: "summary", text: "Stopped at step limit.", ms: 0 };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function titleFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, " ");
  const first = clean.split(/[.?!\n]/)[0] ?? clean;
  const title = first.length > 62 ? `${first.slice(0, 62)}…` : first;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
