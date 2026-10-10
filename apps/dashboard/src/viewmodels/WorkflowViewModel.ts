import type {
  DefinitionBundle,
  RoleDefinition,
  WorkflowDefinition,
} from "@frogie/core/definitions";
import type { RuntimeScope } from "@frogie/core/protocol";
import { serializeWorkflow } from "@frogie/core/workflows";

export interface WorkflowApi {
  saveFile(
    scope: RuntimeScope,
    draft: { path: string; content: string; baseContent: string },
    requestId: string,
  ): Promise<DefinitionBundle>;
}

export interface WorkflowSnapshot {
  readonly scope: RuntimeScope | undefined;
  readonly workflow: WorkflowDefinition | undefined;
  readonly workflows: readonly WorkflowDefinition[];
  readonly roles: readonly RoleDefinition[];
  readonly selectedNodeId: string | null;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly error: string | null;
}

export interface WorkflowViewModel {
  getSnapshot(): WorkflowSnapshot;
  subscribe(listener: () => void): () => void;
  setDefinition(scope: RuntimeScope, definition: DefinitionBundle): void;
  selectWorkflow(id: string): void;
  selectNode(id: string | null): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  connect(source: string, target: string): void;
  addNode(roleId: string): void;
  removeNode(id: string): void;
  save(): Promise<void>;
  dispose(): void;
}

const sameScope = (left: RuntimeScope, right: RuntimeScope): boolean =>
  left.projectId === right.projectId &&
  left.environmentId === right.environmentId &&
  left.squadId === right.squadId &&
  left.harnessId === right.harnessId;

function stepSections(content: string): {
  end: number;
  steps: { id: string; start: number; end: number }[];
} {
  const steps: { id: string; start: number; end: number }[] = [];
  let section = "";
  let fence: string | null = null;
  let offset = 0;
  let end = content.length;
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
    } else if (fence === null) {
      const heading = /^## (.+?)\s*$/.exec(line)?.[1];
      if (heading) {
        if (section === "步骤") {
          end = offset;
          break;
        }
        section = heading;
      }
      const id = /^### (.+?)\s*$/.exec(line)?.[1];
      if (section === "步骤" && id) {
        const previous = steps.at(-1);
        if (previous) previous.end = offset;
        steps.push({ id, start: offset, end: content.length });
      }
    }
    offset += line.length;
  }
  const last = steps.at(-1);
  if (last) last.end = end;
  return { end, steps };
}

function derive(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    entryRole:
      workflow.nodes.find((node) => node.id === workflow.entry)?.role ?? "",
    participants: [...new Set(workflow.nodes.map((node) => node.role))],
  };
}

export function createWorkflowViewModel(api: WorkflowApi): WorkflowViewModel {
  let snapshot: WorkflowSnapshot = {
    scope: undefined,
    workflow: undefined,
    workflows: [],
    roles: [],
    selectedNodeId: null,
    busy: false,
    dirty: false,
    error: null,
  };
  let definition: DefinitionBundle | undefined;
  let sourceHash: string | undefined;
  let disposed = false;
  let generation = 0;
  let retry: { content: string; requestId: string } | undefined;
  const listeners = new Set<() => void>();

  const publish = (change: Partial<WorkflowSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) listener();
  };
  const invalid = (message: string): void => {
    if (snapshot.error !== message) publish({ error: message });
  };
  const editable = (): WorkflowDefinition | undefined => {
    if (disposed || snapshot.busy) return undefined;
    if (!snapshot.workflow) invalid("No active Workflow");
    return snapshot.workflow;
  };
  const edit = (
    workflow: WorkflowDefinition,
    selectedNodeId = snapshot.selectedNodeId,
  ): void => {
    const next = derive(workflow);
    const original = definition?.workflows.find((item) => item.id === next.id);
    publish({
      workflow: next,
      workflows: snapshot.workflows.map((item) =>
        item.id === next.id ? next : item,
      ),
      selectedNodeId,
      dirty:
        original === undefined ||
        serializeWorkflow(next) !== serializeWorkflow(original),
      error: null,
    });
  };

  const viewModel: WorkflowViewModel = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDefinition(scope, incoming) {
      if (disposed) return;
      const same =
        snapshot.scope !== undefined && sameScope(snapshot.scope, scope);
      if (
        same &&
        sourceHash === incoming.contentHash &&
        (snapshot.dirty || definition?.contentHash === incoming.contentHash)
      )
        return;
      if (same && snapshot.dirty) {
        sourceHash = incoming.contentHash;
        invalid("Workflow source changed while the draft has unsaved edits");
        return;
      }
      generation++;
      retry = undefined;
      definition = structuredClone(incoming);
      sourceHash = incoming.contentHash;
      const workflow =
        (same
          ? definition.workflows.find(
              (item) => item.id === snapshot.workflow?.id,
            )
          : undefined) ?? definition.workflows[0];
      publish({
        scope: { ...scope },
        workflow,
        workflows: definition.workflows,
        roles: definition.roles,
        selectedNodeId:
          same &&
          workflow?.nodes.some((node) => node.id === snapshot.selectedNodeId)
            ? snapshot.selectedNodeId
            : null,
        busy: false,
        dirty: false,
        error: null,
      });
    },
    selectWorkflow(id) {
      if (disposed || snapshot.busy) return;
      const workflow = definition?.workflows.find((item) => item.id === id);
      if (!workflow) return invalid(`Unknown Workflow ${id}`);
      if (snapshot.workflow?.id === id) return;
      if (snapshot.dirty)
        return invalid(
          "Save or discard the current Workflow draft before changing Workflow",
        );
      retry = undefined;
      publish({ workflow, selectedNodeId: null, dirty: false, error: null });
    },
    selectNode(id) {
      if (disposed || snapshot.busy) return;
      if (
        id !== null &&
        !snapshot.workflow?.nodes.some((node) => node.id === id)
      )
        return invalid(`Unknown Workflow node ${id}`);
      if (snapshot.selectedNodeId === id) return;
      publish({ selectedNodeId: id, error: null });
    },
    moveNode(id, position) {
      const workflow = editable();
      if (!workflow) return;
      const node = workflow.nodes.find((item) => item.id === id);
      if (!node) return invalid(`Unknown Workflow node ${id}`);
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
        return invalid("Workflow coordinates must be finite");
      if (node.position.x === position.x && node.position.y === position.y)
        return;
      edit({
        ...workflow,
        nodes: workflow.nodes.map((item) =>
          item.id === id ? { ...item, position: { ...position } } : item,
        ),
      });
    },
    connect(source, target) {
      const workflow = editable();
      if (!workflow) return;
      if (
        ![source, target].every((id) =>
          workflow.nodes.some((node) => node.id === id),
        )
      )
        return invalid("Unknown Workflow edge endpoint");
      if (
        workflow.edges.some(
          (edge) => edge.source === source && edge.target === target,
        )
      )
        return;
      edit({ ...workflow, edges: [...workflow.edges, { source, target }] });
    },
    addNode(roleId) {
      const workflow = editable();
      if (!workflow) return;
      const role = snapshot.roles.find((item) => item.id === roleId);
      if (!role || !/^[a-z][a-z0-9-]*$/.test(roleId))
        return invalid(`Unknown Role ${roleId}`);
      let suffix = 1;
      while (workflow.nodes.some((node) => node.id === `${roleId}-${suffix}`))
        suffix++;
      const id = `${roleId}-${suffix}`;
      const { end } = stepSections(workflow.content);
      const newline = workflow.content.includes("\r\n") ? "\r\n" : "\n";
      const content = `${workflow.content.slice(0, end)}${newline}### ${id}${newline}Complete this step using the ${roleId} Role and return its result.${newline}${newline}${workflow.content.slice(end)}`;
      edit(
        {
          ...workflow,
          entry: workflow.nodes.length === 0 ? id : workflow.entry,
          nodes: [
            ...workflow.nodes,
            {
              id,
              title: role.title,
              role: roleId,
              position: { x: workflow.nodes.length * 240, y: 120 },
            },
          ],
          content,
        },
        id,
      );
    },
    removeNode(id) {
      const workflow = editable();
      if (!workflow) return;
      if (!workflow.nodes.some((node) => node.id === id))
        return invalid(`Unknown Workflow node ${id}`);
      const nodes = workflow.nodes.filter((node) => node.id !== id);
      const section = stepSections(workflow.content).steps.find(
        (step) => step.id === id,
      );
      edit(
        {
          ...workflow,
          nodes,
          entry: workflow.entry === id ? (nodes[0]?.id ?? "") : workflow.entry,
          edges: workflow.edges.filter(
            (edge) => edge.source !== id && edge.target !== id,
          ),
          content: section
            ? workflow.content.slice(0, section.start) +
              workflow.content.slice(section.end)
            : workflow.content,
        },
        snapshot.selectedNodeId === id ? null : snapshot.selectedNodeId,
      );
    },
    async save() {
      if (disposed || snapshot.busy || !snapshot.dirty) return;
      const scope = snapshot.scope;
      const workflow = snapshot.workflow;
      if (!scope || !workflow || !definition) return;
      const path = `workflows/${workflow.id}.md`;
      const file = definition.files.find(
        (item) => item.path === path && item.encoding === "utf8",
      );
      if (!file) {
        const error = new Error(`Missing Workflow source file ${path}`);
        invalid(error.message);
        throw error;
      }
      const content = serializeWorkflow(workflow);
      const requestId =
        retry?.content === content
          ? retry.requestId
          : globalThis.crypto.randomUUID();
      retry = { content, requestId };
      const token = generation;
      const hash = sourceHash;
      publish({ busy: true, error: null });
      if (disposed || token !== generation) return;
      try {
        const saved = await api.saveFile(
          scope,
          { path, content, baseContent: file.content },
          requestId,
        );
        if (disposed || token !== generation) return;
        if (sourceHash !== hash && sourceHash !== saved.contentHash) {
          invalid("Workflow source changed during save; the draft is retained");
          return;
        }
        definition = structuredClone(saved);
        sourceHash = saved.contentHash;
        retry = undefined;
        publish({
          workflow: definition.workflows.find(
            (item) => item.id === workflow.id,
          ),
          workflows: definition.workflows,
          roles: definition.roles,
          dirty: false,
          error: null,
        });
      } catch (error) {
        if (!disposed && token === generation)
          invalid(
            error instanceof Error
              ? error.message
              : typeof error === "object" &&
                  error !== null &&
                  "message" in error
                ? String(error.message)
                : String(error),
          );
        throw error;
      } finally {
        if (!disposed && token === generation) publish({ busy: false });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      listeners.clear();
      retry = undefined;
    },
  };
  return viewModel;
}
