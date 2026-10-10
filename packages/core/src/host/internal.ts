import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai";
import type { Registry } from "@earendil-works/pi-durable";
import type { RuntimeHandle, RuntimeOptions } from "../runtime/index.js";
import type { HostModels, HostTool } from "./types.js";

const models = new WeakMap<HostModels, Models>();
export function wrapModels(value: Models): HostModels {
  const handle = Object.freeze({}) as HostModels;
  models.set(handle, value);
  return handle;
}
export function unwrapModels(handle: HostModels): Models {
  const value = models.get(handle);
  if (!value) throw new Error("Invalid host model handle");
  return value;
}
export interface HostInternals {
  readonly runtime: RuntimeHandle;
  readonly harness: RuntimeHandle["harness"];
  readonly registry: Registry;
  readonly tools: readonly HostTool[];
  readonly context: Context;
  readonly options: RuntimeOptions;
}
const hosts = new WeakMap<object, HostInternals>();
export function setHostInternals(host: object, value: HostInternals): void {
  hosts.set(host, value);
}
export function getHostInternals(host: object): HostInternals {
  const value = hosts.get(host);
  if (!value) throw new Error("Invalid host handle");
  return value;
}
