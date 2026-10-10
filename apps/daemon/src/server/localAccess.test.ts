import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalAccess,
  type LocalAccess,
  type LocalRequestIdentity,
} from "./localAccess.js";

const origin = "http://127.0.0.1:4317";
const request: LocalRequestIdentity = {
  host: "127.0.0.1:4317",
  origin,
};
const accesses: LocalAccess[] = [];

function access(value = origin): LocalAccess {
  const local = createLocalAccess(value);
  accesses.push(local);
  return local;
}

afterEach(() => {
  for (const local of accesses.splice(0)) local.close();
  vi.useRealTimers();
});

describe("local access", () => {
  it("permits reads and writes without credentials for the exact local identity", () => {
    const local = access();
    expect(local.authorize(request, false)).toEqual({ id: "local-user" });
    expect(local.authorize(request, true)).toEqual({ id: "local-user" });
    expect(local.authorize({ ...request, origin: undefined }, false)).toEqual({
      id: "local-user",
    });
  });

  it("permits the exact Caddy HTTPS origin without credentials", () => {
    const origin = "https://frogie.dev.hexly.ai";
    const local = access(origin);
    const identity = { host: "frogie.dev.hexly.ai", origin };
    expect(local.authorize(identity, true)).toEqual({ id: "local-user" });
    expect(local.authorize({ ...identity, origin: undefined }, false)).toEqual({
      id: "local-user",
    });
    expect(() =>
      local.authorize(
        { ...identity, origin: "https://other.dev.hexly.ai" },
        false,
      ),
    ).toThrow();
  });

  it.each([
    "https://127.0.0.1:4317",
    "http://example.com:4317",
    "http://127.0.0.1:4317/path",
    "http://user:pass@127.0.0.1:4317",
    "http://127.0.0.1:4317/?secret=value",
    "not-a-url",
    "http://frogie.dev.hexly.ai",
    "https://frogie.dev.hexly.ai.evil.example",
    "https://other.dev.hexly.ai",
    "https://frogie.dev.hexly.ai:444",
    "https://frogie.dev.hexly.ai/",
    "https://frogie.dev.hexly.ai#token=x",
  ])("rejects an unsupported local origin: %s", (value) => {
    expect(() => createLocalAccess(value)).toThrow();
  });

  it.each([undefined, "attacker.example", "localhost:4317", "127.0.0.1:9999"])(
    "rejects a missing or spoofed Host for reads and writes: %s",
    (host) => {
      const local = access();
      for (const write of [false, true]) {
        expect(() => local.authorize({ ...request, host }, write)).toThrow();
      }
      expect(local.authorize(request, true)).toEqual({ id: "local-user" });
    },
  );

  it.each([
    "null",
    "https://attacker.example",
    "http://127.0.0.1:9999",
    `${origin}/`,
  ])(
    "rejects any present non-exact Origin for reads and writes: %s",
    (origin) => {
      const local = access();
      for (const write of [false, true]) {
        expect(() => local.authorize({ ...request, origin }, write)).toThrow();
      }
    },
  );

  it("requires Origin on writes without consuming subsequent local access", () => {
    const local = access();
    expect(() =>
      local.authorize({ ...request, origin: undefined }, true),
    ).toThrow();
    expect(local.authorize(request, true)).toEqual({ id: "local-user" });
  });

  it("has no startup or session expiry and creates no credential timers", () => {
    vi.useFakeTimers();
    const local = access();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(local.authorize(request, true)).toEqual({ id: "local-user" });
    vi.advanceTimersByTime(8 * 60 * 60 * 1000);
    expect(local.authorize({ ...request, origin: undefined }, false)).toEqual({
      id: "local-user",
    });
    expect(local.authorize(request, true)).toEqual({ id: "local-user" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes idempotently with runtime_unavailable and leaves other instances usable", () => {
    const first = access();
    const second = access();
    first.close();
    first.close();
    for (const write of [false, true]) {
      expect(() => first.authorize(request, write)).toThrowError(
        expect.objectContaining({ code: "runtime_unavailable" }),
      );
    }
    expect(second.authorize(request, true)).toEqual({ id: "local-user" });
  });
});
