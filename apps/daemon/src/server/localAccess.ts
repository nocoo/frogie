export interface LocalRequestIdentity {
  readonly host: string | undefined;
  readonly origin: string | undefined;
}

export interface LocalAccess {
  authorize(request: LocalRequestIdentity, write: boolean): { id: string };
  close(): void;
}

export function createLocalAccess(origin: string): LocalAccess {
  const fail = (code: string): never => {
    throw Object.assign(new Error("Local access denied"), { code });
  };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return fail("invalid_request");
  }
  if (
    !(
      (url.protocol === "http:" && url.hostname === "127.0.0.1") ||
      origin === "https://frogie.dev.hexly.ai"
    ) ||
    url.origin !== origin
  )
    fail("invalid_request");

  let closed = false;
  return {
    authorize(request, write) {
      if (closed) return fail("runtime_unavailable");
      if (
        request.host !== url.host ||
        ((write || request.origin !== undefined) && request.origin !== origin)
      )
        fail("forbidden");
      return { id: "local-user" };
    },
    close() {
      closed = true;
    },
  };
}
