/**
 * MarginAgent domain model. UI-agnostic; shared by the demo runner and the
 * (future) local companion service adapter.
 */

export type AgentMode = "ask" | "plan" | "edit" | "agent";

export type ExecutionEnvironment = "demo" | "connected" | "disconnected" | "error";

export type StepKind =
  | "understand"
  | "search"
  | "read"
  | "plan"
  | "edit"
  | "command"
  | "test"
  | "summary";

export type StepStatus = "running" | "done" | "failed" | "blocked";

export interface AgentStep {
  id: string;
  kind: StepKind;
  label: string;
  detail?: string | undefined;
  status: StepStatus;
  at: number;
}

export type MessageRole = "user" | "agent" | "activity" | "tool" | "warning" | "summary" | "thinking";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  at: number;
  steps?: AgentStep[] | undefined;
  plan?: string[] | undefined;
  toolName?: string | undefined;
  toolResult?: string | undefined;
  drawerRef?: DrawerTarget | undefined;
}

export interface FileChange {
  id: string;
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  before: string;
  after: string;
  review: "pending" | "accepted" | "rejected";
}

export interface TerminalExecution {
  id: string;
  command: string;
  cwd: string;
  output: string;
  exitCode: number | null;
  status: "running" | "success" | "failed";
  at: number;
}

export interface TestFailure {
  name: string;
  file: string;
  message: string;
}

export interface TestRun {
  id: string;
  command: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
  status: "running" | "passed" | "failed";
  at: number;
}

export interface Problem {
  id: string;
  severity: "error" | "warning" | "info";
  source: "lint" | "types" | "build" | "runtime";
  file: string;
  line: number;
  message: string;
}

export type ApprovalKind = "write" | "delete" | "command" | "install" | "commit";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  description: string;
  details: string[];
  status: "pending" | "approved" | "rejected";
  at: number;
}

export type TaskStatus = "draft" | "running" | "awaiting-approval" | "complete" | "failed" | "stopped";

export interface Task {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  mode: AgentMode;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  changes: FileChange[];
  terminal: TerminalExecution[];
  tests: TestRun[];
  problems: Problem[];
  approvals: Approval[];
}

export interface FileNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: FileNode[] | undefined;
  content?: string | undefined;
  gitStatus?: "modified" | "added" | "untracked" | undefined;
}

export interface Project {
  id: string;
  name: string;
  workspacePath: string;
  branch: string;
  repository: string;
  dirtyFiles: number;
  ahead: number;
  instructions: string;
  demo: boolean;
  tree: FileNode[];
}

export interface Settings {
  provider: "openai-compatible" | "anthropic" | "local";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxSteps: number;
  defaultMode: AgentMode;
  safeMode: boolean;
  autoApproveSafeActions: boolean;
  autoRunTests: boolean;
  maxRetries: number;
  companionUrl: string;
  companionToken: string;
  activeSkills: string[]; // skill IDs
}

export type DrawerTarget =
  | { type: "file"; path: string }
  | { type: "diff"; changeId: string }
  | { type: "approval"; approvalId: string }
  | { type: "test-failure"; testRunId: string }
  | { type: "run-details"; taskId: string };

export const MODE_LABELS: Record<AgentMode, { label: string; hint: string }> = {
  ask: { label: "Ask", hint: "Answer and analyze — no file changes" },
  plan: { label: "Plan", hint: "Inspect the project and propose a plan" },
  edit: { label: "Edit", hint: "Apply changes after approval" },
  agent: { label: "Agent", hint: "Inspect, edit, run tests, iterate" },
};
