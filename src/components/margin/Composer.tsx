import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, Paperclip, ShieldCheck, Square, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStore } from "@/lib/agent/store";
import { BUILT_IN_SKILLS } from "@/lib/skills";
import { MODE_LABELS, type AgentMode } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

const MODES: AgentMode[] = ["ask", "plan", "edit", "agent"];

export function Composer() {
  const { settings, updateSettings, runTask, isRunning, stopRun, environment } = useStore();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<AgentMode>(settings.defaultMode);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeSkills = settings.activeSkills ?? [];

  const toggleSkill = (id: string) => {
    const next = activeSkills.includes(id)
      ? activeSkills.filter((s) => s !== id)
      : [...activeSkills, id];
    updateSettings({ activeSkills: next });
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isRunning) inputRef.current?.focus();
  }, [isRunning]);

  const submit = () => {
    if (!value.trim() || isRunning) return;
    const prompt = value;
    setValue("");
    void runTask(prompt, mode);
  };

  return (
    <div className="px-6 pb-6">
      <div className="mx-auto w-full max-w-[820px]">
        <div
          className={cn(
            "rounded-2xl bg-surface-raised p-2.5 transition-shadow",
            "shadow-panel focus-within:shadow-glow",
          )}
        >
          <Textarea
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Describe what to build, fix, or investigate…"
            rows={3}
            className="min-h-[76px] resize-none border-0 bg-transparent px-2.5 py-2 text-[15px] leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />

          <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Attach file">
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach a file</TooltipContent>
            </Tooltip>

            {/* Skills picker */}
            <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("size-8 relative", activeSkills.length > 0 && "text-primary")}
                  aria-label="Skills"
                >
                  <Zap className="size-4" />
                  {activeSkills.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                      {activeSkills.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-72 bg-surface-raised p-2">
                <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Skills
                </p>
                <div className="space-y-0.5">
                  {BUILT_IN_SKILLS.map((skill) => {
                    const active = activeSkills.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(skill.id)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          active ? "bg-primary/10" : "hover:bg-secondary",
                        )}
                      >
                        <span className="text-[16px] leading-none mt-0.5">{skill.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("text-[13px] font-medium", active && "text-primary")}>
                              {skill.name}
                            </span>
                            {active && (
                              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                ON
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground line-clamp-2">
                            {skill.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {activeSkills.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateSettings({ activeSkills: [] })}
                    className="mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    Clear all skills
                  </button>
                )}
              </PopoverContent>
            </Popover>

            <Select
              value={settings.modelId}
              onValueChange={(modelId) => updateSettings({ modelId })}
            >
              <SelectTrigger
                className="h-8 w-auto gap-1.5 border-0 bg-transparent text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto (FreeLLMAPI)</SelectItem>
                <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                <SelectItem value="claude-3-5-haiku-20241022">claude-3.5-haiku</SelectItem>
                <SelectItem value="claude-sonnet-4-5">claude-sonnet-4.5</SelectItem>
                <SelectItem value="gemini-2.0-flash">gemini-2.0-flash</SelectItem>
                <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
                <SelectItem value="qwen/qwen3-235b-a22b">qwen3-235b</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] text-muted-foreground">
                <ShieldCheck
                  className={cn("size-3.5", settings.safeMode ? "text-primary" : undefined)}
                />
                Safe mode
                <Switch
                  checked={settings.safeMode}
                  onCheckedChange={(safeMode) => updateSettings({ safeMode })}
                  aria-label="Safe mode"
                  className="ml-1"
                />
              </label>

              <div
                role="radiogroup"
                aria-label="Agent mode"
                className="flex items-center gap-0.5 rounded-lg bg-surface p-0.5"
              >
                {MODES.map((item) => (
                  <Tooltip key={item}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={mode === item}
                        onClick={() => setMode(item)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                          mode === item
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {MODE_LABELS[item].label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{MODE_LABELS[item].hint}</TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {isRunning ? (
                <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={stopRun}>
                  <Square className="size-3.5" /> Stop
                </Button>
              ) : (
                <Button size="sm" className="h-8 gap-1.5" onClick={submit} disabled={!value.trim()}>
                  Run <ArrowUp className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">
          {!settings.apiKey ? (
            <span className="text-warning">
              No API key — open Settings → AI model and paste your <code className="font-mono">freellmapi-…</code> key.
            </span>
          ) : (
            `${settings.modelId} · ⌘↵ to run`
          )}
        </p>
      </div>
    </div>
  );
}
