// Alternate hosts enter as unknown: these guards establish only that a member
// can be invoked. Nothing here declares either host SDK (compact/thinking differ
// between Pi and OMP).
export type HostObject = Record<PropertyKey, unknown>;
export type HostMethod = (this: unknown, ...args: unknown[]) => unknown;

export function isObject(value: unknown): value is HostObject {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

export function field(value: unknown, key: PropertyKey): unknown {
  return isObject(value) ? value[key] : undefined;
}

export function isHostMethod(value: unknown): value is HostMethod {
  return typeof value === "function";
}

/** A callable member, or null when the host does not expose it. */
export function hostMethod(target: unknown, name: string): HostMethod | null {
  const value = field(target, name);
  return isHostMethod(value) ? value : null;
}

export function callHost(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = hostMethod(target, name);
  if (!method) throw new Error(`host does not expose ${name}`);
  return Reflect.apply(method, target, args);
}

export function optionalHostCall(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = hostMethod(target, name);
  return method ? Reflect.apply(method, target, args) : undefined;
}
