export function observeFeature(name, create, ...args) {
  const fixture = globalThis.fixtureApp ||= { features: Object.create(null), ports: Object.create(null) };
  if (Object.hasOwn(fixture.features, name)) throw new Error(`Duplicate application feature: ${name}`);
  const value = create(...args);
  fixture.features[name] = value;
  fixture.ports[name] = args[0];
  return value;
}
