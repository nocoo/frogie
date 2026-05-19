# 01 - System Prompt Builder

## Overview

System Prompt Builder 是 Frogie 的系统提示词配置模块，允许用户在 Web 界面中配置和定制 AI Agent 的行为指令。

**核心目标**：
1. 提供 7 层可配置的 system prompt 结构
2. 支持全局 + Workspace 两层配置继承
3. Chat 时自动组装完整的 system prompt

**参考实现**：
- Claude Code: 完整的多层 system prompt 架构
- open-agent-sdk: `buildSystemPrompt()` + `context.ts`

---

## Architecture

### 7 Layers of System Prompt

| Layer | Name | Description | Editable | Auto-generated |
|-------|------|-------------|----------|----------------|
| L1 | Identity | AI 基础身份和行为规范 | Yes | Default template |
| L2 | System Rules | 工具使用规则、权限说明、输出格式 | Yes | Default template |
| L3 | Tool Descriptions | 工具列表和使用说明（注入到 system） | Yes | From tool definitions |
| L4 | Git Context | Git 状态：分支、最近 commit、status | Yes (template) | Runtime |
| L5 | Project Instructions | 项目指令 (CLAUDE.md 风格) | Yes | - |
| L6 | Working Directory | 工作目录信息 | Yes (template) | Runtime |
| L7 | Date Context | 当前日期 | Yes (template) | Runtime |

### Scope: Global + Workspace

```
┌─────────────────────────────────────────────────────────────┐
│                     Global Prompts                           │
│  (default values for all workspaces)                        │
│  Location: global_prompts table                             │
├─────────────────────────────────────────────────────────────┤
│                    Workspace Override                        │
│  (per-workspace customization, inherits from global)        │
│  Location: workspace_prompts table                          │
└─────────────────────────────────────────────────────────────┘

Resolution order:
1. Check workspace_prompts for workspace-specific value
2. Fall back to global_prompts table
3. Fall back to hardcoded defaults
```

---

## Data Model

### New Table: `global_prompts`

全局 prompt 配置使用独立表，不侵入现有 settings 结构：

```sql
-- Global prompt layers (single source of truth for defaults)
CREATE TABLE global_prompts (
  layer TEXT PRIMARY KEY,  -- 'identity' | 'system_rules' | ... | 'date_context'
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Insert default values
INSERT INTO global_prompts (layer, content) VALUES
  ('identity', '...default...'),
  ('system_rules', '...default...'),
  ('tool_descriptions', '# Available Tools\n\n{{tools}}'),
  ('git_context', '# Git Status\n\n{{git_status}}'),
  ('project_instructions', ''),
  ('working_directory', '# Working Directory\n\n{{cwd}}'),
  ('date_context', 'Today''s date is {{date}}.');
```

### New Table: `workspace_prompts`

```sql
-- Workspace-level prompt overrides
CREATE TABLE workspace_prompts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  layer TEXT NOT NULL,  -- 'identity' | 'system_rules' | ... | 'date_context'
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  
  UNIQUE(workspace_id, layer)
);

CREATE INDEX idx_workspace_prompts_workspace ON workspace_prompts(workspace_id);
```

### Migration File

**文件名**: `004_prompts.sql` (follows existing 003_workspace_color.sql)

---

## API Design

### REST Endpoints

```
GET    /api/prompts/global              # Get all global prompt layers
PUT    /api/prompts/global/:layer       # Update global prompt layer

GET    /api/prompts/:workspaceId        # Get workspace prompts (merged with global)
PUT    /api/prompts/:workspaceId/:layer # Update workspace prompt layer
DELETE /api/prompts/:workspaceId/:layer # Remove workspace override (fall back to global)

POST   /api/prompts/preview             # Preview assembled prompt (for debugging)
```

### Request/Response Types

```typescript
// Layer identifier
type PromptLayer = 
  | 'identity'
  | 'system_rules'
  | 'tool_descriptions'
  | 'git_context'
  | 'project_instructions'
  | 'working_directory'
  | 'date_context'

// Single layer config
interface PromptLayerConfig {
  layer: PromptLayer
  content: string
  enabled: boolean
  isGlobal: boolean      // true = from global, false = workspace override
  isTemplate: boolean    // true = contains {{variables}}
}

// Full prompt config
interface PromptConfig {
  layers: PromptLayerConfig[]
}

// Update layer request body (for PUT endpoints)
interface UpdatePromptLayerRequest {
  content?: string   // New content (optional if only toggling enabled)
  enabled?: boolean  // Toggle layer on/off (optional if only updating content)
}

// Examples:
// PUT /api/prompts/global/identity       { "content": "You are..." }
// PUT /api/prompts/global/identity       { "enabled": false }
// PUT /api/prompts/global/identity       { "content": "...", "enabled": true }
// PUT /api/prompts/:workspaceId/identity { "content": "...", "enabled": true }

// Preview request
interface PreviewRequest {
  workspaceId: string
  // Optional overrides for preview (can override both content and enabled)
  overrides?: Partial<Record<PromptLayer, {
    content?: string
    enabled?: boolean
  }>>
}

// Example:
// POST /api/prompts/preview
// {
//   "workspaceId": "abc123",
//   "overrides": {
//     "identity": { "content": "New identity text" },
//     "git_context": { "enabled": false },
//     "project_instructions": { "content": "Custom rules", "enabled": true }
//   }
// }

// Preview response
interface PreviewResponse {
  assembledPrompt: string
  tokenEstimate: number
  layers: Array<{
    layer: PromptLayer
    content: string
    enabled: boolean
  }>
}
```

---

## UI Design

### Sidebar Integration

在侧边栏 Settings 区域新增 "Prompt Builder" 入口：

```
┌─────────────────────────────────────┐
│  Sidebar                            │
├─────────────────────────────────────┤
│  [Workspace Selector]               │
│  ─────────────────────              │
│  Sessions                           │
│    • Session 1                      │
│    • Session 2                      │
│  ─────────────────────              │
│  Settings                           │
│    • General                        │
│    • MCP Servers                    │
│    • Prompt Builder  ← NEW          │
└─────────────────────────────────────┘
```

### Prompt Builder Panel

```
┌─────────────────────────────────────────────────────────────┐
│  Prompt Builder                              [Global] [WS]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ L1: Identity ─────────────────────────── [✓] ──────┐   │
│  │  You are an AI assistant...                          │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L2: System Rules ─────────────────────── [✓] ──────┐   │
│  │  - Use tools when helpful...                         │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L3: Tool Descriptions ────────────────── [✓] ──────┐   │
│  │  # Available Tools                                   │   │
│  │  {{tools}}                                           │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L4: Git Context ──────────────────────── [✓] ──────┐   │
│  │  # Git Status                                        │   │
│  │  {{git_status}}                                      │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L5: Project Instructions ─────────────── [✓] ──────┐   │
│  │  (Your custom instructions for this project)         │   │
│  │  [Edit]                                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L6: Working Directory ────────────────── [✓] ──────┐   │
│  │  # Working Directory                                 │   │
│  │  {{cwd}}                                             │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ L7: Date Context ─────────────────────── [✓] ──────┐   │
│  │  Today's date is {{date}}.                           │   │
│  │  [Edit] [Reset to Default]                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [Preview Full Prompt]              Est. ~2,500 tokens      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Edit Modal

```
┌─────────────────────────────────────────────────────────────┐
│  Edit: L1 Identity                                    [×]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Scope: ○ Global (all workspaces)                           │
│         ● This workspace only                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ You are an AI assistant with access to tools.       │   │
│  │ Use the tools provided to help the user accomplish  │   │
│  │ their tasks.                                        │   │
│  │                                                     │   │
│  │ # Guidelines                                        │   │
│  │ - Be concise and direct                             │   │
│  │ - Use tools when they would help                    │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│  Markdown supported • Variables: {{cwd}}, {{date}}, etc.    │
│                                                             │
│  [Cancel]                              [Save] [Save & Test] │
└─────────────────────────────────────────────────────────────┘
```

---

## Engine Integration

### System Prompt Builder

```typescript
// packages/server/src/engine/prompt-builder.ts

import type { Workspace } from '../db/types'
import type { ToolDefinition } from './frogie-agent'

interface PromptContext {
  workspace: Workspace
  tools: ToolDefinition[]  // 已加载的完整工具列表
  gitStatus?: string
  date: string
}

interface PromptLayerResult {
  layer: PromptLayer
  content: string
  enabled: boolean
}

/**
 * Build the complete system prompt from configured layers
 * 
 * IMPORTANT: This must be called AFTER all tools (builtin + MCP) are loaded,
 * so that {{tools}} template can be resolved with the complete tool list.
 */
export async function buildSystemPrompt(
  db: DatabaseLike,
  context: PromptContext
): Promise<string> {
  // 1. Load layer configs (workspace override → global → defaults)
  const layers = await loadPromptLayers(db, context.workspace.id)
  
  // 2. Resolve templates with runtime values
  const resolved = layers
    .filter(l => l.enabled)
    .map(l => resolveTemplate(l, context))
  
  // 3. Join all layers
  return resolved.join('\n\n')
}

/**
 * Resolve template variables in a layer
 * 
 * NOTE: Template variables are simple string replacement.
 * User-provided content is NOT sanitized - the user has full control
 * over their own prompts. This is intentional as prompt content
 * is trusted user input (similar to CLAUDE.md files).
 */
function resolveTemplate(
  layer: PromptLayerResult,
  context: PromptContext
): string {
  let content = layer.content
  
  // Replace template variables
  content = content.replace(/\{\{cwd\}\}/g, context.workspace.path)
  content = content.replace(/\{\{date\}\}/g, context.date)
  content = content.replace(/\{\{git_status\}\}/g, context.gitStatus ?? '')
  content = content.replace(/\{\{tools\}\}/g, formatToolDescriptions(context.tools))
  
  return content
}

/**
 * Format tool definitions for system prompt
 */
function formatToolDescriptions(tools: ToolDefinition[]): string {
  return tools
    .map(t => `- **${t.name}**: ${t.description}`)
    .join('\n')
}
```

### Integration with ws-chat.ts

关键改动：**先加载所有工具，再构建 system prompt**

```typescript
// packages/server/src/routes/ws-chat.ts

async function handleChat(...) {
  // ... existing validation code ...
  
  // Get global settings
  const settings = getSettings(state.db)
  
  // Load existing conversation history
  const sessionWithMessages = await state.sessionSync.getSessionWithMessages(sessionId)
  const existingMessages = sessionWithMessages?.messages ?? []

  // Create abort controller
  const abortController = new AbortController()

  // ========================================
  // STEP 1: Load ALL tools FIRST
  // ========================================
  
  // 1a. Built-in tools
  const allTools: ToolDefinition[] = [...BUILTIN_TOOLS]
  const builtinToolExecutor = createBuiltinToolExecutor(workspace.path)
  
  // 1b. MCP tools (async load)
  let mcpToolExecutor: ToolExecutor | null = null
  const mcpConfigs = listEnabledMCPConfigs(state.db, workspaceId)
  if (mcpConfigs.length > 0) {
    try {
      const transportConfigs = mcpConfigs.map((c) => ({
        name: c.name,
        config: toMCPTransportConfig(c),
        enabled: c.enabled,
      }))
      await state.mcpManager.connectForWorkspace(workspaceId, transportConfigs)
      
      const mcpTools = state.mcpManager.getToolsForWorkspace(workspaceId)
      if (mcpTools.length > 0) {
        allTools.push(...mcpTools)
        mcpToolExecutor = createMCPToolExecutor()
      }
    } catch (err) {
      console.error(`Failed to load MCP tools: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  // ========================================
  // STEP 2: Build system prompt with complete tool list
  // ========================================
  
  const systemPrompt = await buildSystemPrompt(state.db, {
    workspace,
    tools: allTools,  // Complete tool list
    gitStatus: await getGitStatus(workspace.path),
    date: new Date().toISOString().split('T')[0],
  })

  // ========================================
  // STEP 3: Create agent with system prompt
  // ========================================
  
  const config: AgentConfig = {
    baseUrl: settings.llm_base_url,
    apiKey: settings.llm_api_key,
    model: model ?? session.model,
    cwd: workspace.path,
    maxTurns: settings.max_turns,
    maxBudgetUsd: settings.max_budget_usd,
    sessionId,
    abortController,
    systemPrompt,  // NEW: pass assembled prompt
  }

  const agent = FrogieAgent.create(config, existingMessages)
  
  // Inject tools with combined executor
  agent.setTools(allTools, createCombinedToolExecutor(builtinToolExecutor, mcpToolExecutor))

  // ... rest of the code ...
}
```

### FrogieAgent Changes

```typescript
// packages/server/src/engine/types.ts
// Add systemPrompt to existing AgentConfig interface

export interface AgentConfig {
  // ... existing fields (baseUrl, apiKey, model, cwd, etc.) ...
  
  /** Optional system prompt (assembled from prompt layers) */
  systemPrompt?: string
}
```

```typescript
// packages/server/src/engine/frogie-agent.ts
// In query() method, pass system prompt to API:

const stream = this.client.messages.stream({
  model: this.config.model,
  max_tokens: 8192,
  system: this.config.systemPrompt,  // NEW: inject system prompt
  messages: this.messages,
  tools: this.tools,
})
```

---

## Default Templates

### L1: Identity

```markdown
You are an AI assistant with access to tools. Use the tools provided to help the user accomplish their tasks.

You should use tools when they would help you complete the task more accurately or efficiently.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming.
```

### L2: System Rules

```markdown
# System

- All text you output outside of tool use is displayed to the user. Use Github-flavored markdown for formatting.
- Tools are executed based on user's permission settings. If the user denies a tool call, do not re-attempt the exact same call.
- Tool results may include <system-reminder> tags containing useful information from the system.
- The conversation has unlimited context through automatic summarization.
```

### L3: Tool Descriptions (Template)

```markdown
# Available Tools

{{tools}}
```

### L4: Git Context (Template)

```markdown
# Git Status

{{git_status}}
```

### L5: Project Instructions

```markdown
(Empty by default - user customizes per project)
```

### L6: Working Directory (Template)

```markdown
# Working Directory

{{cwd}}
```

### L7: Date Context (Template)

```markdown
Today's date is {{date}}.
```

---

## File Changes

### New Files

| File | Description |
|------|-------------|
| `packages/server/src/engine/prompt-builder.ts` | Core prompt assembly logic |
| `packages/server/src/engine/prompt-defaults.ts` | Default template definitions |
| `packages/server/src/engine/prompt-context.ts` | Git status, date extraction |
| `packages/server/src/routes/prompts.ts` | REST API routes |
| `packages/server/src/db/repositories/prompts.ts` | DB operations for both tables |
| `packages/server/src/db/migrations/004_prompts.sql` | New tables |
| `packages/web/src/pages/PromptBuilder.tsx` | Main UI page |
| `packages/web/src/components/PromptLayerCard.tsx` | Layer display card |
| `packages/web/src/components/PromptEditModal.tsx` | Edit modal |
| `packages/web/src/viewmodels/promptBuilderViewModel.ts` | ViewModel |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/src/engine/types.ts` | Add `systemPrompt` to `AgentConfig` |
| `packages/server/src/engine/frogie-agent.ts` | Pass `system` param to API |
| `packages/server/src/routes/ws-chat.ts` | Reorder: load tools → build prompt → create agent |
| `packages/server/src/app.ts` | Register prompts routes |
| `packages/web/src/App.tsx` | Add route to PromptBuilder |
| `packages/web/src/components/AppSidebar.tsx` | Add navigation link |

---

## Implementation Plan

### Phase 1: Backend Foundation

1. **Database migration** (`004_prompts.sql`)
   - Create `global_prompts` table with defaults
   - Create `workspace_prompts` table
   
2. **Repository layer** (`prompts.ts`)
   - `getGlobalPrompt(layer)`
   - `updateGlobalPrompt(layer, content)`
   - `getWorkspacePrompt(workspaceId, layer)`
   - `upsertWorkspacePrompt(workspaceId, layer, content)`
   - `deleteWorkspacePrompt(workspaceId, layer)`
   - `getMergedPrompts(workspaceId)` - returns merged view

3. **Prompt builder** (`prompt-builder.ts`)
   - `buildSystemPrompt(db, context)`
   - `resolveTemplate(layer, context)`
   - `formatToolDescriptions(tools)`

4. **Context utilities** (`prompt-context.ts`)
   - `getGitStatus(cwd)` - git branch, status, recent commits

5. **REST API** (`prompts.ts`)
   - Endpoints as defined above

### Phase 2: Engine Integration

1. **AgentConfig extension**
   - Add `systemPrompt?: string` field

2. **ws-chat.ts refactor**
   - Reorder: load all tools → build prompt → create agent
   - Create combined tool executor

3. **FrogieAgent update**
   - Pass `system` to Anthropic API

### Phase 3: Web UI

1. **ViewModel** (`promptBuilderViewModel.ts`)
   - State: layers, loading, errors
   - Actions: load, save, reset, toggleEnabled

2. **PromptBuilder page**
   - Tab switch: Global / Workspace
   - List of layer cards
   - Preview button

3. **PromptLayerCard component**
   - Display layer name, preview content
   - Enable/disable toggle
   - Edit/Reset buttons

4. **PromptEditModal component**
   - Scope selector (Global/Workspace)
   - Textarea with markdown support
   - Variable hints

### Phase 4: Polish

1. **Token estimation** - Rough token count display
2. **Import/Export** - JSON backup/restore
3. **Presets** - Pre-built prompt templates (optional)

---

## Testing Strategy

### L1: Unit Tests

| Module | Test Focus |
|--------|------------|
| `prompt-builder.ts` | Template resolution, layer merging |
| `prompt-context.ts` | Git status parsing, date formatting |
| `prompts repository` | CRUD operations, merge logic |
| `promptBuilderViewModel` | State management |

### L2: Integration Tests

| Endpoint | Test Cases |
|----------|------------|
| `GET /api/prompts/global` | Returns all 7 layers with defaults |
| `PUT /api/prompts/global/:layer` | Updates and persists |
| `GET /api/prompts/:workspaceId` | Merges workspace + global correctly |
| `DELETE /api/prompts/:workspaceId/:layer` | Falls back to global |
| `POST /api/prompts/preview` | Assembles with tool list |

### L3: E2E Tests

| Flow | Test Scenario |
|------|---------------|
| Configure prompt | User edits L5, saves, verifies persistence |
| Chat with custom prompt | Modified identity affects AI response style |
| Workspace override | WS prompt differs from global |

---

## Security Considerations

1. **Trust model** - Prompt content is trusted user input (same as CLAUDE.md)
   - Users have full control over their own prompts
   - No sanitization/escaping of template output
   - This is intentional - prompts are configuration, not untrusted input

2. **Size limits** - Max 10KB per layer, 50KB total assembled prompt
   - Prevents accidental context overflow
   - Enforced at API layer

3. **Validation** - Layer names must be from allowed enum
   - Prevents arbitrary key injection

4. **Authorization** - Current scope: single-user local app
   - No workspace ownership model needed for v1
   - All prompts editable by the local user
   - Future: if multi-user, add user_id to workspace table

---

## Open Questions

1. **Caching** - Should we cache assembled prompts per session?
2. **Versioning** - Do we need prompt version history?
3. **Sharing** - Should users be able to export/share prompt configs?

---

## References

- [Claude Code prompts.ts](../../../reference/claude-code/src/constants/prompts.ts)
- [open-agent-sdk context.ts](../../../reference/open-agent-sdk-typescript/src/utils/context.ts)
- [Frogie Architecture](../architecture/03-agent-engine.md)
