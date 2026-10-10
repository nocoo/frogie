import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DefinitionBundle,
  loadDefinition,
} from "@frogie/core/definitions";
import type { RuntimeScope } from "@frogie/core/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowViewModel } from "./WorkflowViewModel.js";

const source = fileURLToPath(
  new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
);
const scope: RuntimeScope = {
  projectId: "frogie",
  environmentId: "e2e",
  squadId: "minimal-squad",
  harnessId: "workflow-test",
};
type Save = Parameters<typeof createWorkflowViewModel>[0]["saveFile"];
let definition: DefinitionBundle;
const saveFile = vi.fn<Save>();

function current(vm: ReturnType<typeof createWorkflowViewModel>) {
  const workflow = vm.getSnapshot().workflow;
  if (!workflow) throw new Error("Missing selected Workflow");
  return workflow;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  definition = loadDefinition(source);
  saveFile.mockReset();
});

describe("Workflow ViewModel", () => {
  it("has no constructor I/O and keeps transient selection across identical projections", () => {
    const vm = createWorkflowViewModel({ saveFile });
    const listener = vi.fn();
    const unsubscribe = vm.subscribe(listener);
    expect(saveFile).not.toHaveBeenCalled();
    vm.setDefinition(scope, definition);
    expect(vm.getSnapshot()).toMatchObject({
      scope,
      busy: false,
      dirty: false,
      error: null,
      roles: definition.roles,
      workflows: definition.workflows,
    });
    vm.selectNode("inspect");
    const snapshot = vm.getSnapshot();
    listener.mockClear();
    vm.setDefinition({ ...scope }, structuredClone(definition));
    expect(vm.getSnapshot()).toBe(snapshot);
    expect(vm.getSnapshot().selectedNodeId).toBe("inspect");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    vm.selectNode(null);
    expect(listener).not.toHaveBeenCalled();
    vm.dispose();
  });

  it("moves, connects, adds and removes Role steps while preserving the Markdown skeleton", () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    const original = structuredClone(definition);
    vm.moveNode("inspect", { x: -20, y: 320 });
    expect(
      current(vm).nodes.find((node) => node.id === "inspect")?.position,
    ).toEqual({ x: -20, y: 320 });
    vm.connect("report", "inspect");
    vm.connect("report", "inspect");
    expect(
      current(vm).edges.filter(
        (edge) => edge.source === "report" && edge.target === "inspect",
      ),
    ).toHaveLength(1);
    vm.addNode("reviewer");
    const added = current(vm).nodes.find(
      (node) => !original.workflows[0]?.nodes.some((old) => old.id === node.id),
    );
    if (!added) throw new Error("Missing new Workflow step");
    expect(added.id).toMatch(/^[a-z][a-z0-9-]*$/u);
    expect(added.role).toBe("reviewer");
    expect(current(vm).content).toContain(`### ${added.id}`);
    vm.connect("report", added.id);
    vm.selectNode(added.id);
    vm.removeNode(added.id);
    expect(vm.getSnapshot().selectedNodeId).toBeNull();
    expect(current(vm).nodes).toHaveLength(2);
    expect(current(vm).content).not.toContain(`### ${added.id}`);
    expect(current(vm).content).toContain("## 输出");
    expect(
      current(vm).edges.every(
        (edge) => edge.source !== added.id && edge.target !== added.id,
      ),
    ).toBe(true);
    vm.removeNode("inspect");
    expect(current(vm)).toMatchObject({
      entry: "report",
      entryRole: "command",
      participants: ["command"],
    });
    expect(current(vm).content).not.toContain("### inspect");
    expect(definition).toEqual(original);
    expect(vm.getSnapshot().dirty).toBe(true);
    vm.dispose();
  });

  it("rejects invalid graph edits without losing the previous draft", () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    const original = structuredClone(current(vm));
    for (const operation of [
      () => vm.moveNode("inspect", { x: Number.NaN, y: 0 }),
      () => vm.moveNode("inspect", { x: 0, y: Number.POSITIVE_INFINITY }),
      () => vm.moveNode("unknown", { x: 0, y: 0 }),
      () => vm.connect("inspect", "unknown"),
      () => vm.connect("unknown", "report"),
      () => vm.addNode("unknown"),
      () => vm.removeNode("unknown"),
      () => vm.selectWorkflow("unknown"),
    ]) {
      operation();
      expect(vm.getSnapshot().error).toEqual(expect.any(String));
      expect(current(vm)).toEqual(original);
    }
    expect(saveFile).not.toHaveBeenCalled();
    vm.dispose();
  });

  it("saves the MD file using its original base and leaves derived fields out of frontmatter", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    const file = definition.files.find(
      (file) => file.path === "workflows/review.md",
    );
    if (!file) throw new Error("Missing Workflow source");
    vm.moveNode("inspect", { x: 240, y: 90 });
    saveFile.mockImplementationOnce(async (target, draft) => {
      expect(target).toEqual(scope);
      expect(draft.path).toBe(file.path);
      expect(draft.baseContent).toBe(file.content);
      const header = draft.content.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
      if (!header) throw new Error("Missing Workflow frontmatter");
      expect(header).not.toMatch(/^(entryRole|participants):/mu);
      const directory = await mkdtemp(join(tmpdir(), "frogie-workflow-save-"));
      try {
        await cp(source, directory, { recursive: true });
        await writeFile(join(directory, draft.path), draft.content);
        const saved = loadDefinition(directory);
        expect(
          saved.workflows[0]?.nodes.find((node) => node.id === "inspect")
            ?.position,
        ).toEqual({ x: 240, y: 90 });
        return saved;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    await vm.save();
    expect(saveFile).toHaveBeenCalledOnce();
    expect(saveFile.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(vm.getSnapshot()).toMatchObject({
      busy: false,
      dirty: false,
      error: null,
    });
    await vm.save();
    expect(saveFile).toHaveBeenCalledOnce();
    vm.dispose();
  });

  it("retains failed saves and reuses the same request identity only for unchanged retry content", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    vm.moveNode("inspect", { x: 250, y: 90 });
    saveFile.mockRejectedValue(new Error("Definition changed"));
    await expect(vm.save()).rejects.toThrow("Definition changed");
    await expect(vm.save()).rejects.toThrow("Definition changed");
    expect(vm.getSnapshot()).toMatchObject({
      dirty: true,
      busy: false,
      error: "Definition changed",
    });
    expect(saveFile.mock.calls[1]?.[2]).toBe(saveFile.mock.calls[0]?.[2]);
    vm.moveNode("inspect", { x: 500, y: 90 });
    await expect(vm.save()).rejects.toThrow("Definition changed");
    expect(saveFile.mock.calls[2]?.[2]).not.toBe(saveFile.mock.calls[0]?.[2]);
    vm.dispose();
  });

  it("guards duplicate in-flight saves and ignores their results after switching full scope", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    vm.moveNode("inspect", { x: 250, y: 90 });
    const saving = deferred<DefinitionBundle>();
    saveFile.mockReturnValueOnce(saving.promise);
    const operation = vm.save();
    expect(vm.getSnapshot().busy).toBe(true);
    const duplicate = vm.save();
    expect(saveFile).toHaveBeenCalledOnce();
    const nextScope = { ...scope, harnessId: "new-harness" };
    vm.setDefinition(nextScope, definition);
    const selected = vm.getSnapshot();
    saving.resolve({
      ...definition,
      title: "Stale source",
      contentHash: "old-save",
    });
    await Promise.all([operation, duplicate]);
    expect(vm.getSnapshot()).toBe(selected);
    expect(vm.getSnapshot()).toMatchObject({
      scope: nextScope,
      dirty: false,
      busy: false,
    });
    vm.dispose();
  });

  it("keeps dirty MD on a source refresh and cancels new I/O after disposal", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    vm.moveNode("inspect", { x: 260, y: 90 });
    const draft = structuredClone(current(vm));
    vm.setDefinition(scope, { ...definition, contentHash: "external-edit" });
    expect(current(vm)).toEqual(draft);
    expect(vm.getSnapshot()).toMatchObject({
      dirty: true,
      error: expect.any(String),
    });
    const saving = deferred<DefinitionBundle>();
    saveFile.mockReturnValueOnce(saving.promise);
    const result = vm.save();
    const listener = vi.fn();
    vm.subscribe(listener);
    vm.dispose();
    vm.dispose();
    saving.resolve(definition);
    await result;
    await vm.save();
    vm.moveNode("inspect", { x: 1, y: 1 });
    vm.setDefinition(scope, definition);
    expect(saveFile).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps fenced headings and CRLF content intact when removing and adding real step sections", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "frogie-workflow-markdown-"),
    );
    const vm = createWorkflowViewModel({ saveFile });
    try {
      await cp(source, directory, { recursive: true });
      const workflow = definition.workflows[0];
      const file = definition.files.find(
        (file) => file.path === "workflows/review.md",
      );
      if (!workflow || !file) throw new Error("Missing fixture Workflow");
      const content = workflow.content
        .replace(
          "Review the material and collect evidence.",
          "Review the material and collect evidence.\n\n````md\n### report\n## 输出\n```\n~~~~\n````\n\n~~~md\n### report\n## 输出\n~~~",
        )
        .replace(/\n/g, "\r\n");
      await writeFile(
        join(directory, file.path),
        file.content.slice(0, file.content.indexOf("## 目标")) + content,
      );
      const original = loadDefinition(directory);
      vm.setDefinition(scope, original);
      vm.selectNode("inspect");
      vm.removeNode("report");
      expect(current(vm).content).toContain(
        "### report\r\n## 输出\r\n```\r\n~~~~\r\n````",
      );
      expect(current(vm).content).not.toContain("Summarize the findings.");
      expect(vm.getSnapshot().selectedNodeId).toBe("inspect");
      vm.addNode("reviewer");
      const firstAdded = vm.getSnapshot().selectedNodeId;
      vm.addNode("reviewer");
      const secondAdded = vm.getSnapshot().selectedNodeId;
      if (!firstAdded || !secondAdded)
        throw new Error("Missing appended steps");
      expect(secondAdded).not.toBe(firstAdded);
      vm.connect("inspect", firstAdded);
      vm.connect(firstAdded, secondAdded);
      const drafted = structuredClone(current(vm));
      saveFile.mockImplementationOnce(async (_scope, draft) => {
        await writeFile(join(directory, draft.path), draft.content);
        return loadDefinition(directory);
      });
      await vm.save();
      expect(current(vm).content).toBe(drafted.content);
      expect(current(vm).content).toContain(`### ${firstAdded}\r\n`);
      expect(current(vm).content).toContain("## 验收要点\r\n");
      expect(
        current(vm)
          .nodes.map((node) => node.id)
          .sort(),
      ).toEqual(drafted.nodes.map((node) => node.id).sort());
      expect(vm.getSnapshot()).toMatchObject({ dirty: false, error: null });
    } finally {
      vm.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects clean Workflows, rejects switching dirty drafts and restores clean state for reverted coordinates", () => {
    const vm = createWorkflowViewModel({ saveFile });
    const first = definition.workflows[0];
    if (!first) throw new Error("Missing fixture Workflow");
    const second = {
      ...structuredClone(first),
      id: "second",
      title: "Second Workflow",
    };
    vm.setDefinition(scope, { ...definition, workflows: [first, second] });
    vm.selectWorkflow("second");
    expect(current(vm).id).toBe("second");
    vm.selectWorkflow("second");
    vm.selectNode("unknown");
    expect(vm.getSnapshot().error).toContain("Unknown Workflow node");
    vm.selectNode("inspect");
    vm.selectNode("inspect");
    expect(vm.getSnapshot().selectedNodeId).toBe("inspect");
    const position = current(vm).nodes.find(
      (node) => node.id === "inspect",
    )?.position;
    if (!position) throw new Error("Missing fixture coordinates");
    vm.moveNode("inspect", { ...position });
    expect(vm.getSnapshot().dirty).toBe(false);
    vm.moveNode("inspect", { x: 200, y: 200 });
    vm.setDefinition(scope, { ...definition, workflows: [first, second] });
    expect(vm.getSnapshot().dirty).toBe(true);
    vm.selectWorkflow("review");
    expect(current(vm).id).toBe("second");
    expect(vm.getSnapshot().error).toContain("draft");
    vm.moveNode("inspect", position);
    expect(vm.getSnapshot()).toMatchObject({ dirty: false, error: null });
    vm.selectWorkflow("review");
    expect(current(vm).id).toBe("review");
    vm.selectNode("inspect");
    vm.setDefinition(scope, {
      ...definition,
      contentHash: "new-clean-projection",
    });
    expect(vm.getSnapshot().selectedNodeId).toBe("inspect");
    vm.dispose();
  });

  it("locks editing, Workflow selection and duplicate saves until the accepted save response settles", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, definition);
    vm.moveNode("inspect", { x: 210, y: 90 });
    const pending = deferred<DefinitionBundle>();
    saveFile.mockReturnValueOnce(pending.promise);
    const running = vm.save();
    const locked = vm.getSnapshot();
    for (const action of [
      () => vm.selectNode("report"),
      () => vm.selectWorkflow("missing"),
      () => vm.moveNode("inspect", { x: 1, y: 1 }),
      () => vm.connect("report", "inspect"),
      () => vm.addNode("reviewer"),
      () => vm.removeNode("inspect"),
    ])
      action();
    await vm.save();
    expect(vm.getSnapshot()).toBe(locked);
    expect(saveFile).toHaveBeenCalledOnce();
    pending.resolve({ ...definition, contentHash: "saved-projection" });
    await running;
    expect(vm.getSnapshot()).toMatchObject({
      busy: false,
      dirty: false,
      error: null,
    });
    vm.dispose();
  });

  it("retains a draft if external source changes during save but accepts the matching committed projection", async () => {
    for (const matching of [false, true]) {
      const vm = createWorkflowViewModel({ saveFile });
      vm.setDefinition(scope, definition);
      vm.moveNode("inspect", { x: 210, y: 90 });
      const draft = structuredClone(current(vm));
      const pending = deferred<DefinitionBundle>();
      saveFile.mockReturnValueOnce(pending.promise);
      const running = vm.save();
      vm.setDefinition(scope, {
        ...definition,
        contentHash: matching ? "saved-projection" : "external-change",
      });
      pending.resolve({ ...definition, contentHash: "saved-projection" });
      await running;
      if (matching)
        expect(vm.getSnapshot()).toMatchObject({
          dirty: false,
          error: null,
          busy: false,
        });
      else {
        expect(current(vm)).toEqual(draft);
        expect(vm.getSnapshot()).toMatchObject({
          dirty: true,
          busy: false,
          error: expect.stringContaining("source changed"),
        });
      }
      vm.dispose();
    }
  });

  it("ignores late rejection after full scope changes or disposal without hiding it from the original caller", async () => {
    for (const boundary of ["scope", "dispose"] as const) {
      const vm = createWorkflowViewModel({ saveFile });
      vm.setDefinition(scope, definition);
      vm.moveNode("inspect", { x: 210, y: 90 });
      const pending = deferred<DefinitionBundle>();
      saveFile.mockReturnValueOnce(pending.promise);
      const running = vm.save();
      const failure = expect(running).rejects.toThrow("Late source failure");
      if (boundary === "scope")
        vm.setDefinition(
          {
            ...scope,
            projectId: "other-project",
            environmentId: "other-env",
            squadId: "other-squad",
            harnessId: "other-harness",
          },
          definition,
        );
      else vm.dispose();
      const snapshot = vm.getSnapshot();
      pending.reject(new Error("Late source failure"));
      await failure;
      expect(vm.getSnapshot()).toBe(snapshot);
      vm.dispose();
    }
  });

  it("handles missing Markdown sources, empty graphs and retained callbacks after disposal without new I/O", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.addNode("reviewer");
    expect(vm.getSnapshot().error).toBe("No active Workflow");
    const listener = vi.fn();
    vm.subscribe(listener);
    vm.addNode("reviewer");
    expect(listener).not.toHaveBeenCalled();
    vm.setDefinition(scope, { ...definition, files: [] });
    vm.moveNode("inspect", { x: 220, y: 90 });
    await expect(vm.save()).rejects.toThrow("Missing Workflow source");
    expect(saveFile).not.toHaveBeenCalled();
    vm.setDefinition({ ...scope, harnessId: "fresh" }, definition);
    vm.removeNode("inspect");
    vm.removeNode("report");
    expect(current(vm)).toMatchObject({
      entry: "",
      entryRole: "",
      participants: [],
      nodes: [],
    });
    vm.addNode("command");
    expect(current(vm).entry).toBe(vm.getSnapshot().selectedNodeId);
    expect(current(vm).entryRole).toBe("command");
    vm.dispose();
    const snapshot = vm.getSnapshot();
    vm.subscribe(listener)();
    vm.selectNode(null);
    vm.selectWorkflow("review");
    vm.connect("unknown", "unknown");
    vm.addNode("command");
    vm.removeNode("report");
    await vm.save();
    expect(vm.getSnapshot()).toBe(snapshot);
  });

  it("retains drafts for non-Error save failures and formats only their observable message", async () => {
    for (const failure of [
      { message: "Conflict DTO" },
      "Network unavailable",
      null,
    ]) {
      const vm = createWorkflowViewModel({ saveFile });
      vm.setDefinition(scope, definition);
      vm.moveNode("inspect", { x: 200, y: 220 });
      saveFile.mockRejectedValueOnce(failure);
      await expect(vm.save()).rejects.toBe(failure);
      expect(vm.getSnapshot()).toMatchObject({
        dirty: true,
        busy: false,
        error:
          failure && typeof failure === "object"
            ? failure.message
            : String(failure),
      });
      vm.dispose();
    }
  });

  it("does not issue a save when a busy-state subscriber disposes or changes the full scope synchronously", async () => {
    for (const boundary of ["scope", "dispose"] as const) {
      const vm = createWorkflowViewModel({ saveFile });
      vm.setDefinition(scope, definition);
      vm.moveNode("inspect", { x: 200, y: 220 });
      vm.subscribe(() => {
        if (!vm.getSnapshot().busy) return;
        if (boundary === "dispose") vm.dispose();
        else
          vm.setDefinition(
            { ...scope, harnessId: "subscriber-selected-harness" },
            definition,
          );
      });
      await vm.save();
      expect(saveFile).not.toHaveBeenCalled();
      if (boundary === "scope")
        expect(vm.getSnapshot()).toMatchObject({
          busy: false,
          dirty: false,
          scope: { harnessId: "subscriber-selected-harness" },
        });
      vm.dispose();
    }
  });

  it("keeps an empty definition usable without pretending a Workflow exists", async () => {
    const vm = createWorkflowViewModel({ saveFile });
    vm.setDefinition(scope, { ...definition, workflows: [] });
    expect(vm.getSnapshot().workflow).toBeUndefined();
    await vm.save();
    expect(saveFile).not.toHaveBeenCalled();
    vm.dispose();
  });
});
