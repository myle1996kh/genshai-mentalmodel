import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Copy, Download, FileText, Brain, Wrench, RefreshCw } from 'lucide-react';
import type { BlueprintExport } from '@/types/openclaw';

interface Advisor {
  id: string;
  name?: string;
  title?: string;
  type: 'persona' | 'framework' | 'book';
  hasBluePrint: boolean;
}

interface OpenClawExportPanelProps {
  advisors: Advisor[];
  loading?: boolean;
  onRefresh?: () => void;
}

export const OpenClawExportPanel = ({ advisors, loading, onRefresh }: OpenClawExportPanelProps) => {
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<BlueprintExport | null>(null);

  const selectedAdvisor = advisors.find((a) => a.id === selectedAdvisorId);

  const handleExport = async () => {
    if (!selectedAdvisor) return;

    setExporting(true);
    setExportResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('export-openclaw', {
        body: { advisorId: selectedAdvisor.id, advisorType: selectedAdvisor.type },
      });

      if (error) throw error;
      setExportResult(data as BlueprintExport);
      toast.success('OpenClaw config generated');
    } catch (e: any) {
      toast.error(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    if (!exportResult || !selectedAdvisor) return;
    const name = selectedAdvisor.name || selectedAdvisor.title || 'advisor';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    downloadFile(exportResult.soulMd, `${slug}-SOUL.md`);
    downloadFile(exportResult.agentsMd, `${slug}-AGENTS.md`);
    exportResult.skillMds.forEach((s) => {
      downloadFile(s.content, `${slug}-SKILL-${s.name}.md`);
    });
    toast.success(`Downloaded ${2 + exportResult.skillMds.length} files`);
  };

  // Show all advisors, not just those with blueprints — export will generate on-the-fly
  const exportableAdvisors = advisors;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="font-serif flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Export as OpenClaw Config
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium font-sans text-muted-foreground">Select Advisor</label>
             <Select value={selectedAdvisorId} onValueChange={setSelectedAdvisorId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an advisor to export..." />
              </SelectTrigger>
              <SelectContent>
                {exportableAdvisors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      {a.type === 'persona' && <Brain className="w-3.5 h-3.5" />}
                      {a.type === 'framework' && <FileText className="w-3.5 h-3.5" />}
                      {a.type === 'book' && <FileText className="w-3.5 h-3.5" />}
                      {a.name || a.title}
                      <span className="text-xs text-muted-foreground">({a.type})</span>
                    </span>
                  </SelectItem>
                ))}
                 {exportableAdvisors.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No advisors found
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleExport} disabled={!selectedAdvisorId || exporting} className="gap-2">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            Generate
          </Button>
          {onRefresh && (
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>

        {exportResult && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-sans text-muted-foreground">
                Generated {2 + exportResult.skillMds.length} file(s) for{' '}
                <span className="font-medium text-foreground">{selectedAdvisor?.name || selectedAdvisor?.title}</span>
              </p>
              <Button variant="outline" size="sm" onClick={downloadAll} className="gap-2 font-sans text-xs">
                <Download className="w-3.5 h-3.5" />
                Download All
              </Button>
            </div>

            <Tabs defaultValue="soul" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="soul" className="flex-1 text-xs">SOUL.md</TabsTrigger>
                <TabsTrigger value="agents" className="flex-1 text-xs">AGENTS.md</TabsTrigger>
                {exportResult.skillMds.length > 0 && (
                  <TabsTrigger value="skills" className="flex-1 text-xs">
                    SKILL.md ({exportResult.skillMds.length})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="soul">
                <FilePreview
                  content={exportResult.soulMd}
                  filename="SOUL.md"
                  onCopy={() => copyToClipboard(exportResult.soulMd, 'SOUL.md')}
                  onDownload={() => {
                    const slug = (selectedAdvisor?.name || selectedAdvisor?.title || 'advisor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    downloadFile(exportResult.soulMd, `${slug}-SOUL.md`);
                  }}
                />
              </TabsContent>

              <TabsContent value="agents">
                <FilePreview
                  content={exportResult.agentsMd}
                  filename="AGENTS.md"
                  onCopy={() => copyToClipboard(exportResult.agentsMd, 'AGENTS.md')}
                  onDownload={() => {
                    const slug = (selectedAdvisor?.name || selectedAdvisor?.title || 'advisor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    downloadFile(exportResult.agentsMd, `${slug}-AGENTS.md`);
                  }}
                />
              </TabsContent>

              {exportResult.skillMds.length > 0 && (
                <TabsContent value="skills">
                  <div className="space-y-3">
                    {exportResult.skillMds.map((skill, idx) => (
                      <FilePreview
                        key={skill.name || idx}
                        content={skill.content}
                        filename={`SKILL-${skill.name}.md`}
                        label={skill.description}
                        onCopy={() => copyToClipboard(skill.content, skill.name)}
                        onDownload={() => {
                          const slug = (selectedAdvisor?.name || selectedAdvisor?.title || 'advisor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                          downloadFile(skill.content, `${slug}-SKILL-${skill.name}.md`);
                        }}
                      />
                    ))}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function FilePreview({
  content,
  filename,
  label,
  onCopy,
  onDownload,
}: {
  content: string;
  filename: string;
  label?: string;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div>
          <span className="text-xs font-mono font-medium">{filename}</span>
          {label && <span className="ml-2 text-xs text-muted-foreground">{label}</span>}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onCopy} className="h-7 px-2 text-xs gap-1">
            <Copy className="w-3 h-3" /> Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={onDownload} className="h-7 px-2 text-xs gap-1">
            <Download className="w-3 h-3" /> Save
          </Button>
        </div>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
        {content}
      </pre>
    </div>
  );
}
