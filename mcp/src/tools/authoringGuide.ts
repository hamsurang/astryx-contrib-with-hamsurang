import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { json, type ToolContext } from '../context.js';
import { loadTemplate, loadTemplateVersions } from '../sources/repo.js';

export const authoringGuideInput = z.object({
  kind: z.enum(['component', 'module', 'spec', 'theme', 'family', 'architecture']),
});

const KNOWLEDGE_MAP = ['workflow:knowledge-map#placement', 'workflow:knowledge-map#authority'];
const BUILD_PHASES = [
  'phase-1-setup', 'phase-2-foundation', 'phase-3-system-integration-check', 'phase-4-implementation', 'phase-5-status-states',
  'phase-6-stories', 'phase-7-tests', 'phase-8-documentation', 'phase-9-pr', 'phase-10-self-review',
].map((s) => `wiki:Component-Build-Protocol#${s}`);
const SPEC_PHASES = [
  'phase-1-triage', 'phase-2-research-internal', 'phase-3-research-external', 'phase-4-enumerate-use-cases', 'phase-5-draft-spec',
  'phase-6-surface-area-audit', 'phase-7-spec-review', 'phase-8-api-arbitration', 'phase-9-finalize-spec',
].map((s) => `wiki:Component-Specification-Protocol#${s}`);

const GUIDES: Record<z.infer<typeof authoringGuideInput>['kind'], { steps: string[]; template: string; versionKey: string }> = {
  component: {
    steps: ['wiki:Component-Lifecycle#before-you-start', 'wiki:Component-Lifecycle#phase-1-specification', 'wiki:Component-Lifecycle#phase-2-build', ...BUILD_PHASES],
    template: 'component-spec.md', versionKey: 'component',
  },
  module: { steps: KNOWLEDGE_MAP, template: 'module-spec.md', versionKey: 'module' },
  spec: { steps: SPEC_PHASES, template: 'system-spec.md', versionKey: 'system-spec' },
  theme: { steps: ['wiki:Theming-Infrastructure#theming-infrastructure', 'wiki:Theming-Infrastructure#component-theming', ...KNOWLEDGE_MAP], template: 'theme-spec.md', versionKey: 'theme' },
  family: { steps: KNOWLEDGE_MAP, template: 'family-contract.md', versionKey: 'family' },
  architecture: { steps: KNOWLEDGE_MAP, template: 'architecture.md', versionKey: 'architecture' },
};

export interface GuideResult {
  kind: string;
  steps: { sectionId: string; heading?: string; body?: string; missing?: true }[];
  template?: string;
  templateVersion?: number;
  warnings: string[];
}

export async function authoringGuide(ctx: ToolContext, input: z.infer<typeof authoringGuideInput>): Promise<GuideResult> {
  const guide = GUIDES[input.kind];
  const warnings = [...ctx.index.warnings];
  const steps = guide.steps.map((sectionId) => {
    const sec = ctx.index.getSection(sectionId);
    return sec ? { sectionId, heading: sec.heading, body: sec.body } : { sectionId, missing: true as const };
  });
  const template = await loadTemplate(ctx.repoRoot, guide.template);
  if (!template) warnings.push(`template not found: ${guide.template}`);
  const versions = await loadTemplateVersions(ctx.repoRoot);
  return { kind: input.kind, steps, template, templateVersion: versions?.[guide.versionKey], warnings };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'authoring_guide',
    { description: 'Step-by-step guide and the knowledge template for writing a new component, module, system spec, theme, family, or architecture record.', inputSchema: authoringGuideInput },
    async (input) => json(await authoringGuide(ctx, input)),
  );
}
