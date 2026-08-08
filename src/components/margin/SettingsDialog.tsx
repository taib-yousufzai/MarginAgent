import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/agent/store";
import { MODE_LABELS, type AgentMode } from "@/lib/agent/types";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="max-w-[52%]">
        <Label className="text-[13.5px] font-medium">{label}</Label>
        {hint ? <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex min-w-[210px] justify-end">{children}</div>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, updateSettings, project } = useStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] gap-0 overflow-hidden bg-surface-raised p-0 sm:max-w-[720px]">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="font-display text-[19px]">Settings</DialogTitle>
          <DialogDescription className="text-[13px]">
            Configure your AI model, agent behaviour, and project preferences.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ai" className="mt-4 gap-0">
          <TabsList className="mx-6 h-8 bg-surface p-0.5">
            <TabsTrigger value="ai" className="h-7 px-3 text-[12.5px]">
              AI model
            </TabsTrigger>
            <TabsTrigger value="behavior" className="h-7 px-3 text-[12.5px]">
              Agent behaviour
            </TabsTrigger>
            <TabsTrigger value="project" className="h-7 px-3 text-[12.5px]">
              Project
            </TabsTrigger>
          </TabsList>

          <div className="scroll-slim max-h-[58vh] overflow-y-auto px-6 pb-6">
            {/* ── AI Model ── */}
            <TabsContent value="ai" className="m-0 divide-y">
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3.5 mt-3 mb-1">
                <p className="text-[12.5px] font-medium text-primary">FreeLLMAPI</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Configured for your local FreeLLMAPI instance at{" "}
                  <code className="font-mono">localhost:3001</code>. Paste the{" "}
                  <code className="font-mono">freellmapi-…</code> key from its dashboard below.
                </p>
              </div>
              <Row label="API key" hint="Your freellmapi-… key from the FreeLLMAPI dashboard (localhost:3001).">
                <Input
                  type="password"
                  value={settings.apiKey}
                  placeholder="freellmapi-…"
                  onChange={(e) => updateSettings({ apiKey: e.target.value })}
                  className="w-[210px] font-mono text-[12.5px]"
                />
              </Row>
              <Row label="Model" hint="Use 'auto' to let FreeLLMAPI pick the best available model, or enter a specific model ID.">
                <Input
                  value={settings.modelId}
                  onChange={(e) => updateSettings({ modelId: e.target.value })}
                  className="w-[210px] font-mono text-[12.5px]"
                  placeholder="auto"
                />
              </Row>
              <Row label="Base URL" hint="Change only if FreeLLMAPI is running on a different port.">
                <Input
                  value={settings.baseUrl}
                  onChange={(e) => updateSettings({ baseUrl: e.target.value })}
                  className="w-[210px] font-mono text-[12.5px]"
                  placeholder="http://localhost:3001/v1"
                />
              </Row>
              <Row label="Temperature" hint={`Currently ${settings.temperature.toFixed(1)}`}>
                <Slider
                  value={[settings.temperature]}
                  min={0}
                  max={1}
                  step={0.1}
                  onValueChange={([temperature]) =>
                    updateSettings({ temperature: temperature ?? 0.3 })
                  }
                  className="w-[190px]"
                />
              </Row>
            </TabsContent>

            {/* ── Agent behaviour ── */}
            <TabsContent value="behavior" className="m-0 divide-y">
              <Row label="Default mode">
                <Select
                  value={settings.defaultMode}
                  onValueChange={(mode) => updateSettings({ defaultMode: mode as AgentMode })}
                >
                  <SelectTrigger className="w-[210px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MODE_LABELS) as AgentMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {MODE_LABELS[mode].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row
                label="Safe mode"
                hint="Require approval before writing files or running commands."
              >
                <Switch
                  checked={settings.safeMode}
                  onCheckedChange={(safeMode) => updateSettings({ safeMode })}
                />
              </Row>
              <Row label="Maximum retry attempts">
                <Input
                  type="number"
                  value={settings.maxRetries}
                  onChange={(e) => updateSettings({ maxRetries: Number(e.target.value) })}
                  className="w-[110px]"
                />
              </Row>
            </TabsContent>

            {/* ── Project ── */}
            <TabsContent value="project" className="m-0 divide-y">
              <Row label="Workspace path">
                <span className="font-mono text-[12.5px] text-muted-foreground">
                  {project?.workspacePath ?? "—"}
                </span>
              </Row>
              <div className="py-3.5">
                <Label className="text-[13.5px] font-medium">Project instructions</Label>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Always sent to the agent for this workspace.
                </p>
                <Separator className="my-3" />
                <Textarea
                  defaultValue={project?.instructions ?? ""}
                  rows={5}
                  className="bg-surface text-[13px]"
                  placeholder="Conventions, constraints, things to never touch…"
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
