import { ArrowRight, FolderOpen, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { exampleTasks } from "@/lib/agent/demo-workspace";
import { useStore } from "@/lib/agent/store";

export function Welcome({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { runTask, settings } = useStore();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[720px]">
        <div className="mb-10 flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
            <Terminal className="size-4" />
          </span>
          <span className="font-display text-[17px] font-semibold">MarginAgent</span>
        </div>

        <h1 className="max-w-[560px] text-[42px] font-semibold leading-[1.1]">
          Build, fix, and understand your code with an AI agent.
        </h1>
        <p className="mt-4 max-w-[520px] text-[15.5px] leading-7 text-muted-foreground">
          A local-first software engineering workspace. Describe what you want — MarginAgent reasons
          through your request and responds with analysis, plans, or code.
        </p>

        <div className="mt-9 flex flex-wrap gap-2.5">
          <Button size="lg" className="h-11 gap-2" onClick={onOpenSettings}>
            <FolderOpen className="size-4" /> Configure model
          </Button>
        </div>

        <div className="mt-14">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Example tasks
          </h2>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {exampleTasks.map((task) => (
              <li key={task}>
                <button
                  type="button"
                  onClick={() => void runTask(task, settings.defaultMode)}
                  className="group flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left text-[13.5px] leading-6 text-foreground/85 transition-colors hover:bg-surface-raised"
                >
                  <span className="flex-1">"{task}"</span>
                  <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-12 text-[12.5px] leading-6 text-muted-foreground">
          Connects to any OpenAI-compatible API — OpenAI, Anthropic, Ollama, or any local model.
          Configure your endpoint and model in Settings.
        </p>
      </div>
    </main>
  );
}
