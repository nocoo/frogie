import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppView, type AppViewProps } from "./views/AppView.js";

const rootMock = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: rootMock.createRoot,
}));

import { mountDashboard } from "./main.js";

beforeEach(() => {
  vi.clearAllMocks();
  rootMock.createRoot.mockReturnValue({
    render: rootMock.render,
    unmount: rootMock.unmount,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRendered(): ReactElement<AppViewProps> {
  return rootMock.render.mock.calls.at(-1)?.[0] as ReactElement<AppViewProps>;
}

describe("mountDashboard", () => {
  it("rejects a missing element without creating a React root", () => {
    expect(() => mountDashboard(undefined as unknown as HTMLElement)).toThrow();
    expect(rootMock.createRoot).not.toHaveBeenCalled();
  });

  it("returns the same disposer for repeated mounts of the same element", () => {
    const element = { nodeType: 1 } as HTMLElement;
    const first = mountDashboard(element);
    const second = mountDashboard(element);
    expect(second).toBe(first);
    expect(rootMock.createRoot).toHaveBeenCalledOnce();
    first();
  });

  it("creates a fresh root after disposing a previous mount", () => {
    const element = { nodeType: 1 } as HTMLElement;
    const firstDispose = mountDashboard(element);
    firstDispose();
    const secondDispose = mountDashboard(element);
    expect(rootMock.createRoot).toHaveBeenCalledTimes(2);
    expect(rootMock.unmount).toHaveBeenCalledOnce();
    secondDispose();
    expect(rootMock.unmount).toHaveBeenCalledTimes(2);
  });

  it("updates the selected page and ignores navigation after disposal", () => {
    const element = { nodeType: 1 } as HTMLElement;
    const dispose = mountDashboard(element);
    const initial = lastRendered();
    expect(initial.props.page).toBe("overview");
    initial.props.onPageChange("chat");
    expect(rootMock.render).toHaveBeenCalledTimes(2);
    expect(lastRendered().props.page).toBe("chat");

    dispose();
    lastRendered().props.onPageChange("evals");
    expect(rootMock.render).toHaveBeenCalledTimes(2);
  });

  it("does not bootstrap when the document global is absent", async () => {
    vi.stubGlobal("document", undefined);
    vi.resetModules();
    await expect(import("./main.js")).resolves.toHaveProperty("mountDashboard");
    expect(rootMock.createRoot).not.toHaveBeenCalled();
  });

  it("does not mount when the document has no dashboard root", async () => {
    vi.stubGlobal("document", { getElementById: vi.fn(() => null) });
    vi.resetModules();
    await import("./main.js");
    expect(rootMock.createRoot).not.toHaveBeenCalled();
  });

  it("keeps disconnected shell actions harmless until services are connected", () => {
    const element = { nodeType: 1 } as HTMLElement;
    mountDashboard(element);
    const props = lastRendered().props;

    expect(props.onModeChange("e2e")).toBeUndefined();
    expect(props.onSquadChange("zeppelin")).toBeUndefined();
    expect(props.onCreateSquad()).toBeUndefined();
    expect(rootMock.render).toHaveBeenCalledOnce();
  });

  it("bootstraps the root element when the document is available", async () => {
    const element = { nodeType: 1 } as HTMLElement;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => element),
    });
    vi.resetModules();
    await import("./main.js");
    expect(rootMock.createRoot).toHaveBeenCalledOnce();
    expect(rootMock.createRoot).toHaveBeenCalledWith(element);
    expect(rootMock.render).toHaveBeenCalledOnce();
  });

  it("mounts the empty AppView once and returns an idempotent disposer", () => {
    const element = { nodeType: 1 } as HTMLElement;
    const dispose = mountDashboard(element);

    expect(rootMock.createRoot).toHaveBeenCalledOnce();
    expect(rootMock.createRoot).toHaveBeenCalledWith(element);
    expect(rootMock.render).toHaveBeenCalledOnce();
    const rendered = rootMock.render.mock
      .calls[0]?.[0] as ReactElement<AppViewProps>;
    expect(rendered.type).toBe(AppView);
    expect(rendered.props.squads).toEqual([]);
    expect(rendered.props.selectedSquadId).toBeNull();
    expect(rendered.props.busy).toBe(false);
    expect(rendered.props.error).toBeNull();

    dispose();
    dispose();
    expect(rootMock.unmount).toHaveBeenCalledOnce();
  });
});
