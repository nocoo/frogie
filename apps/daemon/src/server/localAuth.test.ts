import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAuth, type LocalRequestIdentity } from "./localAuth.js";

const origin = "http://127.0.0.1:4317";
const request: LocalRequestIdentity = {
  host: "127.0.0.1:4317",
  origin,
  cookie: undefined,
  csrf: undefined,
};

afterEach(() => vi.useRealTimers());

describe("local authentication", () => {
  it("uses Secure cookies and exact Caddy origin for the local HTTPS domain", () => {
    const origin = "https://frogie.dev.hexly.ai";
    const identity = { ...request, host: "frogie.dev.hexly.ai", origin };
    const auth = createLocalAuth(origin);
    const session = auth.exchange(identity, auth.bootstrapToken);
    expect(session.cookie).toContain("; Secure");
    const authenticated = {
      ...identity,
      cookie: session.cookie.split(";")[0],
      csrf: session.csrf,
    };
    expect(auth.authorize(authenticated, true)).toEqual(session.caller);
    expect(
      auth.resume({ ...authenticated, csrf: undefined, origin: undefined }),
    ).toEqual({ csrf: session.csrf, caller: session.caller });
    expect(() =>
      auth.resume({ ...authenticated, origin: "https://other.dev.hexly.ai" }),
    ).toThrow();
    expect(() =>
      auth.resume({ ...authenticated, cookie: undefined }),
    ).toThrow();
    auth.close();
    expect(() => auth.resume(authenticated)).toThrow();
  });

  it("exchanges a one-time token for a scoped HttpOnly session", () => {
    const auth = createLocalAuth(origin);
    expect(auth.bootstrapToken).toMatch(/^[a-zA-Z0-9_-]{43,}$/);
    const session = auth.exchange(request, auth.bootstrapToken);
    expect(session.cookie).toMatch(/^frogie_session=[a-zA-Z0-9_-]+;/);
    expect(session.cookie).toContain("HttpOnly");
    expect(session.cookie).toContain("SameSite=Strict");
    expect(session.cookie).toContain("Path=/__local");
    expect(session.csrf).not.toBe(auth.bootstrapToken);
    const authenticated = {
      ...request,
      cookie: session.cookie.split(";")[0],
      csrf: session.csrf,
    };
    expect(auth.authorize(authenticated, true)).toEqual(session.caller);
    expect(
      auth.authorize(
        { ...authenticated, origin: undefined, csrf: undefined },
        false,
      ),
    ).toEqual(session.caller);
    expect(() => auth.exchange(request, auth.bootstrapToken)).toThrow();
    auth.close();
    auth.close();
    expect(() => auth.authorize(authenticated, false)).toThrow();
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
    expect(() => createLocalAuth(value)).toThrow();
  });

  it("keeps startup credentials valid after invalid token or origin attempts", () => {
    const auth = createLocalAuth(origin);
    for (const token of ["", "bad", "x".repeat(43)]) {
      expect(() => auth.exchange(request, token)).toThrow();
    }
    for (const headers of [
      { ...request, host: "attacker.example" },
      { ...request, host: undefined },
      { ...request, origin: "https://attacker.example" },
      { ...request, origin: undefined },
      { ...request, origin: "null" },
    ]) {
      expect(() => auth.exchange(headers, auth.bootstrapToken)).toThrow();
    }
    expect(auth.exchange(request, auth.bootstrapToken).caller.id).toEqual(
      expect.any(String),
    );
    auth.close();
  });

  it("requires an exact session, trusted host and CSRF proof for writes", () => {
    const auth = createLocalAuth(origin);
    const session = auth.exchange(request, auth.bootstrapToken);
    const cookie = session.cookie.split(";")[0];
    const valid = { ...request, cookie, csrf: session.csrf };
    for (const invalid of [
      { ...valid, cookie: undefined },
      { ...valid, cookie: "unrelated=abc" },
      { ...valid, cookie: "frogie_session=incorrect" },
      { ...valid, cookie: `${cookie}; ${cookie}` },
      { ...valid, host: "localhost:4317" },
      { ...valid, origin: "http://127.0.0.1:9999" },
      { ...valid, origin: undefined },
      { ...valid, csrf: undefined },
      { ...valid, csrf: "incorrect" },
    ]) {
      expect(() => auth.authorize(invalid, true)).toThrow();
    }
    expect(() =>
      auth.authorize({ ...valid, origin: "https://attacker.example" }, false),
    ).toThrow();
    expect(
      auth.authorize(
        { ...valid, cookie: `other=123; ${cookie}; last=456` },
        true,
      ),
    ).toEqual(session.caller);
    auth.close();
  });

  it("expires the bootstrap credential after five minutes", () => {
    vi.useFakeTimers();
    const auth = createLocalAuth(origin);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(() => auth.exchange(request, auth.bootstrapToken)).toThrow();
    expect(vi.getTimerCount()).toBe(0);
    auth.close();
  });

  it("expires sessions after eight hours without background timers", () => {
    vi.useFakeTimers();
    const auth = createLocalAuth(origin);
    const session = auth.exchange(request, auth.bootstrapToken);
    const authenticated = {
      ...request,
      cookie: session.cookie.split(";")[0],
      csrf: session.csrf,
    };
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 - 1);
    expect(auth.authorize(authenticated, true)).toEqual(session.caller);
    vi.advanceTimersByTime(1);
    expect(() => auth.authorize(authenticated, false)).toThrow();
    expect(vi.getTimerCount()).toBe(0);
    auth.close();
  });

  it("isolates separate server sessions and invalidates startup on close", () => {
    const first = createLocalAuth(origin);
    const second = createLocalAuth(origin);
    const session = first.exchange(request, first.bootstrapToken);
    expect(second.bootstrapToken).not.toBe(first.bootstrapToken);
    expect(() =>
      second.authorize(
        {
          ...request,
          cookie: session.cookie.split(";")[0],
          csrf: session.csrf,
        },
        true,
      ),
    ).toThrow();
    first.close();
    second.close();
    expect(() => second.exchange(request, second.bootstrapToken)).toThrow();
  });
});
