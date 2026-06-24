#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const ZDRAVO_BLUE = '\x1b[38;2;59;130;246m'
const ZDRAVO_YELLOW = '\x1b[38;2;255;215;0m'
const RESET = '\x1b[0m'

const API_BASE = process.env.ZDRAVO_API_URL ?? "https://www.zdravo.ai"
const API_KEY = process.env.ZDRAVO_API_KEY ?? process.env.ZDRAVO_API_TOKEN

if (!API_KEY) {
  console.error(`${ZDRAVO_BLUE}🔐 Zdravo AI${RESET} - MCP API key required. Set ZDRAVO_API_KEY to a scoped Zdravo API key.`)
  process.exit(1)
}

if (!API_KEY.startsWith('zdravo_')) {
  console.error(`${ZDRAVO_BLUE}🔐 Zdravo AI${RESET} - ZDRAVO_API_KEY must be a scoped Zdravo API key, not a Supabase JWT.`)
  process.exit(1)
}

const headers = {
  'X-API-Key': API_KEY,
  'Content-Type': 'application/json',
  'X-MCP-Version': '2.2.4',
}

const toolRequirements: Record<string, string[]> = {
  save_to_zdravo: ['mcp:personal'],
  search_zdravo: ['mcp:personal'],
  get_zdravo_stats: ['mcp:personal'],
  auto_inject: ['mcp:personal'],
  search_org_memories: ['mcp:org'],
  get_team_context: ['mcp:org'],
  save_org_memory: ['mcp:org'],
  get_constitution: ['mcp:org'],
  auto_capture: ['mcp:org'],
  save_session_summary: ['mcp:org'],
  zdravo_hardware_status: ['mcp:personal'],
  zdravo_swarm_publish: ['mcp:org'],
  zdravo_scaffold: ['mcp:org'],
}

let validatedKey: { scopes?: string[] } | null = null

async function api(path: string, method = 'GET', body?: unknown, requiredScopes: string[] = ['mcp:personal']) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...headers,
      'X-MCP-Required-Scopes': requiredScopes.join(','),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Zdravo API ${method} ${path} → ${res.status}: ${err}`)
  }

  return res.json()
}

async function validateApiKey() {
  const res = await fetch(`${API_BASE}/api/mcp/validate-key`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scopes: ['mcp:personal'] }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Zdravo API key validation failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.error || 'Zdravo API key validation failed')
  }

  validatedKey = data.key
}

function requireScopes(toolName: string) {
  const requiredScopes = toolRequirements[toolName] ?? ['mcp:personal']
  const scopes = new Set(Array.isArray(validatedKey?.scopes) ? validatedKey.scopes : [])

  if (scopes.has('mcp:all') || scopes.has('admin')) {
    return
  }

  const missing = requiredScopes.filter(scope => !scopes.has(scope))
  if (missing.length) {
    throw new Error(`MCP API key is missing required scopes: ${missing.join(', ')}`)
  }
}

function formatBrandedOutput(name: string, data: unknown): string {
  const emoji: Record<string, string> = {
    save_to_zdravo: '✨',
    search_zdravo: '🔍',
    get_zdravo_stats: '📊',
    auto_inject: '💉',
    search_org_memories: '🏢',
    get_team_context: '👥',
    save_org_memory: '💾',
    get_constitution: '📜',
    auto_capture: '📹',
    save_session_summary: '📝',
    zdravo_hardware_status: '🖥️',
    zdravo_swarm_publish: '🐝',
    zdravo_scaffold: '🏗️',
  }

  const emojiChar = emoji[name] ?? '📦'
  const header = `${ZDRAVO_BLUE}${emojiChar} Zdravo AI${RESET}`
  const d = data as Record<string, unknown>

  if (d?.error) {
    return `${header} ${ZDRAVO_YELLOW}Error:${RESET} ${String(d.error)}`
  }

  if (d?.memories ?? d?.results) {
    const results = (d.memories ?? d.results ?? []) as Array<Record<string, unknown>>
    const items = results.map((m, i) =>
      `  ${ZDRAVO_YELLOW}[${i + 1}]${RESET} ${String(m.title ?? m.id ?? '')} ${m.score ? `(${Math.round(Number(m.score) * 100)}%)` : ''}`
    ).join('\n')
    return `${header} Found ${results.length} memories:\n${items}`
  }

  if (d?.totalMemories !== undefined) {
    return `${header} Account Stats:
  Total Memories: ${d.totalMemories ?? 0}
  Used This Month: ${d.usedThisMonth ?? 0}
  Plan: ${d.plan ?? 'Free'}`
  }

  if (d?.memory_id || d?.id) {
    return `${header} Saved: ${d.memory_id ?? d.id}`
  }

  return `${header} ${JSON.stringify(data, null, 2)}`
}

// ── Hardware Status Helper ────────────────────────────────────────────────────

async function getHardwareStatus(): Promise<{
  gpu: { utilization: number; temperature: number; memoryUsed: number; memoryTotal: number };
  cpu: { utilization: number };
  recommendedBackend: string;
  thermalStatus: string;
}> {
  try {
    const { execSync } = await import('child_process');
    const smi = execSync('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = smi.trim().split('\n');
    const [gpuUtil, gpuTemp, gpuMemUsed, gpuMemTotal] = lines[0].split(',').map(s => parseInt(s.trim()));

    const cpuInfo = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const thermalThreshold = parseInt(process.env.THERMAL_THRESHOLD || '82');
    const gpuOffloadThreshold = parseInt(process.env.GPU_OFFLOAD_THRESHOLD || '85');

    let recommendedBackend = 'local-vllm';
    let thermalStatus = 'optimal';

    if ((gpuTemp || 0) > thermalThreshold) {
      recommendedBackend = 'cloud-openai';
      thermalStatus = 'throttling';
    } else if ((gpuUtil || 0) > gpuOffloadThreshold) {
      recommendedBackend = 'local-ollama';
      thermalStatus = 'high-load';
    }

    return {
      gpu: {
        utilization: gpuUtil || 0,
        temperature: gpuTemp || 0,
        memoryUsed: (gpuMemUsed || 0) / 1024,
        memoryTotal: (gpuMemTotal || 0) / 1024,
      },
      cpu: { utilization: parseFloat(cpuInfo) || 0 },
      recommendedBackend,
      thermalStatus,
    };
  } catch {
    return {
      gpu: { utilization: 0, temperature: 45, memoryUsed: 0, memoryTotal: 24 },
      cpu: { utilization: 0 },
      recommendedBackend: 'local-ollama',
      thermalStatus: 'unknown',
    };
  }
}

// ── Scaffolding Helper ───────────────────────────────────────────────────────

const SCAFFOLDING_TEMPLATES: Record<string, { name: string; code: string; tags: string[] }> = {
  'database_migration': {
    name: 'Create Table Migration',
    code: [
      "import { sql } from '@vercel/postgres';",
      '',
      'export async function up() {',
      '  await sql`CREATE TABLE IF NOT EXISTS new_table (',
      '    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '    created_at TIMESTAMPTZ DEFAULT NOW(),',
      '    organization_id UUID NOT NULL REFERENCES organizations(id),',
      '    user_id UUID NOT NULL REFERENCES auth.users(id)',
      '  );`;',
      '  await sql`ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;`;',
      '  await sql`CREATE POLICY "Users can view own records" ON new_table FOR SELECT USING (auth.uid() = user_id);`;',
      '}',
      '',
      'export async function down() {',
      '  await sql`DROP TABLE IF EXISTS new_table;`;',
      '}',
    ].join('\n'),
    tags: ['database', 'migration', 'rls'],
  },
  'api_endpoint': {
    name: 'Next.js API Route Handler',
    code: [
      "import { NextRequest, NextResponse } from 'next/server';",
      "import { createClient } from '@/lib/supabase/server';",
      "import { withSecurity } from '@/lib/security/middleware';",
      '',
      'export const GET = withSecurity(async (request: NextRequest) => {',
      '  const supabase = await createClient();',
      '  const { data: { user }, error } = await supabase.auth.getUser();',
      '  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });',
      '  try {',
      '    return NextResponse.json({ success: true });',
      '  } catch (error) {',
      '    return NextResponse.json({ error: "Internal server error" }, { status: 500 });',
      '  }',
      '});',
    ].join('\n'),
    tags: ['api', 'nextjs', 'security'],
  },
  'authentication': {
    name: 'Auth Middleware',
    code: [
      "import { NextRequest, NextResponse } from 'next/server';",
      "import { createClient } from '@/lib/supabase/server';",
      '',
      'export async function withAuth(request: NextRequest, handler: (user: { id: string; email: string }) => Promise<NextResponse>): Promise<NextResponse> {',
      '  const supabase = await createClient();',
      '  const { data: { user }, error } = await supabase.auth.getUser();',
      '  if (error || !user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });',
      '  return handler({ id: user.id, email: user.email! });',
      '}',
    ].join('\n'),
    tags: ['auth', 'middleware', 'security'],
  },
  'testing': {
    name: 'API Route Test',
    code: [
      "import { describe, it, expect, vi, beforeEach } from 'vitest';",
      "import { GET } from './route';",
      "import { createClient } from '@/lib/supabase/server';",
      '',
      "vi.mock('@/lib/supabase/server');",
      '',
      "describe('API Route', () => {",
      "  beforeEach(() => { vi.clearAllMocks(); });",
      '',
      "  it('returns 401 when not authenticated', async () => {",
      "    vi.mocked(createClient).mockResolvedValue({",
      "      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error() }) },",
      "    } as any);",
      '    const response = await GET(new Request("http://localhost/api/test") as any);',
      '    expect(response.status).toBe(401);',
      '  });',
      '});',
    ].join('\n'),
    tags: ['test', 'vitest'],
  },
};

async function autoInjectContext(opts: {
  filePath: string;
  fileContent?: string;
  language?: string;
}): Promise<{
  injected: boolean;
  query: string;
  memories: Array<{ id: string; title: string; content: string; score: number; tier: string }>;
  message: string;
}> {
  const { filePath, fileContent, language } = opts;

  const parts: string[] = [];
  const fileName = filePath.split('/').pop() || '';
  const dirParts = filePath.split('/').filter(Boolean);
  const relevantDirs = dirParts.slice(-3, -1);
  parts.push(fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
  parts.push(relevantDirs.join(' '));
  if (language) parts.push(language);
  if (fileContent) {
    const imports = fileContent.match(/(?:import|from|require)\s+['"]([^'"]+)['"]/g) || [];
    const identifiers = fileContent.match(/(?:function|class|const|let|var|export)\s+(\w+)/g) || [];
    parts.push(...imports.slice(0, 5).map(i => i.replace(/['"]/g, '')));
    parts.push(...identifiers.slice(0, 5).map(i => i.replace(/(?:function|class|const|let|var|export)\s+/, '')));
  }

  const query = parts.filter(Boolean).join(' ').substring(0, 500);

  if (!query.trim()) {
    return { injected: false, query: '', memories: [], message: 'No context to search from' };
  }

  try {
    const result = await api('/api/recall/query', 'POST', {
      query,
      limit: 5,
      threshold: 0.5,
    }, ['mcp:personal']);

    const memories = (result as any)?.results || (result as any)?.memories || [];

    return {
      injected: memories.length > 0,
      query,
      memories: memories.map((m: any) => ({
        id: m.id,
        title: m.title || 'Untitled',
        content: (m.content || '').substring(0, 300),
        score: m.similarity || m.score || 0,
        tier: m.tier || 'warm',
      })),
      message: memories.length > 0
        ? `Found ${memories.length} relevant memories for ${fileName}`
        : `No relevant memories found for ${fileName}`,
    };
  } catch (error) {
    return {
      injected: false,
      query,
      memories: [],
      message: `Search failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

async function getScaffolding(opts: {
  filePath?: string;
  taskDescription: string;
  tags?: string[];
}): Promise<{ templates: Array<{ name: string; code: string; relevance: number }> }> {
  const { filePath, taskDescription, tags } = opts;
  const combined = `${taskDescription} ${filePath || ''} ${(tags || []).join(' ')}`.toLowerCase();

  const scored = Object.entries(SCAFFOLDING_TEMPLATES).map(([key, template]) => {
    let score = 0;
    for (const tag of template.tags) {
      if (combined.includes(tag)) score += 2;
    }
    if (filePath && template.code.includes(filePath.split('/').pop()?.split('.')[0] || '')) score += 3;
    return { key, name: template.name, code: template.code, relevance: score };
  });

  return {
    templates: scored
      .filter(t => t.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3)
      .map(({ name, code, relevance }) => ({ name, code, relevance })),
  };
}

const server = new Server(
  { name: 'zdravo-mcp', version: '2.2.4' },
  { capabilities: { tools: {}, resources: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'save_to_zdravo',
      description: 'Save a conversation, insight, or text to your personal Zdravo memory.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          content: { type: 'string', maxLength: 100000 },
          platform: { type: 'string', default: 'claude' },
          memory_type: {
            type: 'string',
            enum: ['episodic', 'semantic', 'procedural', 'emotional', 'conceptual'],
            default: 'episodic',
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'search_zdravo',
      description: 'Semantic search over your personal memories.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          top_k: { type: 'number', default: 5 },
          threshold: { type: 'number', default: 0.65 },
          semantic: { type: 'boolean', default: true },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_zdravo_stats',
      description: 'Get your Zdravo account statistics and memory usage.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'search_org_memories',
      description: 'Search the organization\'s collective knowledge base. Requires an org-scoped API key.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: ['org', 'team', 'project'], default: 'org' },
          project_id: { type: 'string' },
          limit: { type: 'number', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_team_context',
      description: 'Get organizational context: recent decisions, active projects, known constraints.',
      inputSchema: {
        type: 'object',
        properties: {
          context_type: {
            type: 'string',
            enum: ['recent_decisions', 'project_status', 'tech_stack', 'constraints', 'all'],
            default: 'all',
          },
          limit: { type: 'number', default: 10 },
        },
      },
    },
    {
      name: 'save_org_memory',
      description: 'Save a decision, solution, or insight to the organization knowledge base so team members and other agents can find it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          content: { type: 'string', maxLength: 100000 },
          memory_type: {
            type: 'string',
            enum: ['decision', 'solution', 'architecture', 'policy', 'lesson', 'context'],
            default: 'decision',
          },
          project_id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'get_constitution',
      description: 'Get the organization\'s AI constitution — standing instructions, policies, and context that should inform all AI interactions with org data.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'auto_capture',
      description: 'Capture a session summary to organizational memory. Extracts key decisions, insights, and context from session content.',
      inputSchema: {
        type: 'object',
        properties: {
          session_content: { type: 'string', description: 'Full session transcript/content' },
          session_type: { type: 'string', enum: ['debug', 'feature', 'refactor', 'analysis', 'general'] },
          title: { type: 'string' },
          project_id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['session_content', 'session_type'],
      },
    },
    {
      name: 'save_session_summary',
      description: 'Save a session summary to memory. Persists agent session data including conversation, decisions, and code.',
      inputSchema: {
        type: 'object',
        properties: {
          conversation: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          session_title: { type: 'string' },
          session_purpose: { type: 'string' },
          key_decisions: { type: 'array', items: { type: 'string' } },
          important_code: { type: 'string' },
          project_id: { type: 'string' },
        },
        required: ['conversation', 'session_title', 'session_purpose'],
      },
    },
    {
      name: 'zdravo_hardware_status',
      description: 'Get real-time hardware metrics for compute arbitrage routing. Shows GPU utilization, temperature, memory, and suggests optimal inference backend.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'zdravo_swarm_publish',
      description: 'Publish a discovery, solution, or warning to the A2A swarm. Other agents subscribed to relevant channels will receive this in real-time.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['discovery', 'solution', 'warning', 'context_update', 'request_help'],
            description: 'Type of message to publish',
          },
          finding: {
            type: 'string',
            description: 'What was discovered or the solution found',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for routing (e.g., database, api, auth, security)',
          },
          confidence: {
            type: 'number',
            description: 'Confidence in this finding (0-1)',
            default: 0.8,
          },
        },
        required: ['type', 'finding', 'tags'],
      },
    },
    {
      name: 'zdravo_scaffold',
      description: 'Get predictive scaffolding: historically-approved, SOC2-compliant boilerplate code for your current task. Prevents architectural drift.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path of the file you are working on',
          },
          task_description: {
            type: 'string',
            description: 'Description of what you are building',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for matching (e.g., migration, api, auth, test)',
          },
        },
        required: ['task_description'],
      },
    },
    {
      name: 'auto_inject',
      description: 'Retrieve memories ranked by relevance to the current file path and content.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Full path of the currently active file' },
          file_content: { type: 'string', description: 'First 2000 chars of the file content (optional, improves relevance)' },
          language: { type: 'string', description: 'Programming language (e.g., typescript, python, rust)' },
        },
        required: ['file_path'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArguments } = request.params
  const args = rawArguments as Record<string, unknown> | undefined

  try {
    requireScopes(name)

    let result: unknown
    switch (name) {
      case 'save_to_zdravo':
        result = await api('/api/v1/memories', 'POST', {
          title: args?.title,
          content: args?.content,
          sourcePlatform: args?.platform || 'mcp',
          memoryType: args?.memory_type,
          tags: args?.tags,
        }, ['mcp:personal'])
        break
      case 'search_zdravo':
        result = await api('/api/recall/query', 'POST', args, ['mcp:personal'])
        break
      case 'get_zdravo_stats':
        result = await api('/api/v2/user/stats', 'GET', undefined, ['mcp:personal'])
        break
      case 'search_org_memories':
        result = await api('/api/recall/query', 'POST', { ...args, scope: 'org' }, ['mcp:org'])
        break
      case 'get_team_context':
        result = await api('/api/recall/query', 'POST', { ...args, context_type: 'all' }, ['mcp:org'])
        break
      case 'save_org_memory':
        result = await api('/api/v1/memories', 'POST', { ...args, sourcePlatform: 'mcp-org' }, ['mcp:org'])
        break
      case 'get_constitution':
        result = await api('/api/memory-graph', 'POST', { query: 'constitution policies' }, ['mcp:org'])
        break
      case 'auto_capture':
        result = await api('/api/v1/memories', 'POST', { ...args, sourcePlatform: 'mcp-auto', memoryType: 'episodic' }, ['mcp:org'])
        break
      case 'save_session_summary':
        result = await api('/api/v1/memories', 'POST', { ...args, sourcePlatform: 'mcp-session', memoryType: 'procedural' }, ['mcp:org'])
        break
      case 'zdravo_hardware_status':
        result = await getHardwareStatus()
        break
      case 'zdravo_swarm_publish':
        result = await api('/api/v1/memories', 'POST', {
          title: `Swarm: ${args?.type}`,
          content: args?.finding || '',
          sourcePlatform: 'mcp-swarm',
          memoryType: 'semantic',
          tags: args?.tags || ['swarm'],
        }, ['mcp:org'])
        break
      case 'zdravo_scaffold':
        result = await getScaffolding({
          filePath: args?.file_path as string,
          taskDescription: args?.task_description as string,
          tags: args?.tags as string[],
        })
        break
      case 'auto_inject':
        result = await autoInjectContext({
          filePath: args?.file_path as string,
          fileContent: args?.file_content as string | undefined,
          language: args?.language as string | undefined,
        })
        break
      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [{ type: 'text', text: formatBrandedOutput(name, result) }],
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `${ZDRAVO_BLUE}❌ Zdravo AI${RESET} ${message}` }],
      isError: true,
    }
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'zdravo://user/info',
      name: 'User Account Info',
      description: 'Current authenticated user information and plan details',
      mimeType: 'application/json',
    },
    {
      uri: 'zdravo://user/stats',
      name: 'Memory Usage Stats',
      description: 'Memory and usage statistics for current billing period',
      mimeType: 'application/json',
    },
    {
      uri: 'zdravo://org/info',
      name: 'Organization Info',
      description: 'Organization details, plan, and member count (org keys only)',
      mimeType: 'application/json',
    },
  ],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params
  let path: string

  if (uri === 'zdravo://user/info') {
    path = '/api/v2/user/info'
  } else if (uri === 'zdravo://user/stats') {
    path = '/api/v2/user/stats'
  } else if (uri === 'zdravo://org/info') {
    path = '/api/v2/org/info'
  } else {
    throw new Error(`Unknown resource: ${uri}`)
  }

  const data = await api(path, 'GET', undefined, path === '/api/v2/org/info' ? ['mcp:org'] : ['mcp:personal'])
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
  }
})

try {
  await validateApiKey()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${ZDRAVO_BLUE}🔐 Zdravo AI${RESET} - ${message}`)
  process.exit(1)
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`${ZDRAVO_BLUE}🔐 Zdravo AI MCP Server${RESET} ready`)
