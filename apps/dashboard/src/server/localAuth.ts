import { randomBytes, timingSafeEqual } from "node:crypto";

export interface LocalRequestIdentity {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly cookie: string | undefined;
  readonly csrf: string | undefined;
}

export interface LocalSession {
  readonly cookie: string;
  readonly csrf: string;
  readonly caller: { readonly id: string };
}

export interface LocalAuth {
  readonly bootstrapToken: string;
  exchange(request: LocalRequestIdentity, token: string): LocalSession;
  authorize(
    request: LocalRequestIdentity,
    write: boolean,
  ): LocalSession["caller"];
  close(): void;
}

export function createLocalAuth(origin: string): LocalAuth {
  const fail = (
    code: "invalid_request" | "unauthenticated" | "forbidden",
  ): never => {
    throw Object.assign(new Error("Local authentication failed"), { code });
  };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return fail("invalid_request");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.origin !== origin
  )
    fail("invalid_request");

  const secret = (): string => randomBytes(32).toString("base64url");
  const matches = (value: string | undefined, expected: string): boolean => {
    if (value === undefined || value.length !== expected.length) return false;
    const bytes = Buffer.from(value);
    const expectedBytes = Buffer.from(expected);
    return (
      bytes.length === expectedBytes.length &&
      timingSafeEqual(bytes, expectedBytes)
    );
  };
  let bootstrap = secret();
  const bootstrapToken = bootstrap;
  const bootstrapExpires = Date.now() + 5 * 60 * 1000;
  let session:
    | { token: string; csrf: string; expires: number; caller: { id: string } }
    | undefined;
  let closed = false;

  const verifyOrigin = (
    request: LocalRequestIdentity,
    required: boolean,
  ): void => {
    if (
      request.host !== url.host ||
      ((required || request.origin !== undefined) && request.origin !== origin)
    )
      fail("forbidden");
  };

  return {
    bootstrapToken,
    exchange(request, token) {
      if (closed || !bootstrap || Date.now() >= bootstrapExpires)
        fail("unauthenticated");
      verifyOrigin(request, true);
      if (!matches(token, bootstrap)) fail("unauthenticated");
      const tokenValue = secret();
      const csrf = secret();
      const caller = { id: "local-user" };
      session = {
        token: tokenValue,
        csrf,
        caller,
        expires: Date.now() + 8 * 60 * 60 * 1000,
      };
      bootstrap = "";
      return {
        cookie: `frogie_session=${tokenValue}; HttpOnly; SameSite=Strict; Path=/__local; Max-Age=28800`,
        csrf,
        caller,
      };
    },
    authorize(request, write) {
      if (closed || !session || Date.now() >= session.expires)
        return fail("unauthenticated");
      verifyOrigin(request, write);
      const cookies = new Map<string, string>();
      for (const part of request.cookie?.split(";") ?? []) {
        const separator = part.indexOf("=");
        if (separator < 1) fail("invalid_request");
        const name = part.slice(0, separator).trim();
        if (!name || cookies.has(name)) fail("invalid_request");
        cookies.set(name, part.slice(separator + 1).trim());
      }
      if (!matches(cookies.get("frogie_session"), session.token))
        fail("unauthenticated");
      if (write && !matches(request.csrf, session.csrf)) fail("forbidden");
      return session.caller;
    },
    close() {
      closed = true;
      bootstrap = "";
      session = undefined;
    },
  };
}
