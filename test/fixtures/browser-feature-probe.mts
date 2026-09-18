import {
  FEATURE_FACTORY_NAMES,
  FIXTURE_FEATURE_NAMES,
  FIXTURE_PORT_NAMES,
  type FixtureFactories,
  type FixtureFeatureName,
  type FixtureFeatures,
  type FixtureObservationRegistry,
  type FixturePorts,
  type FixtureRegistry,
} from '../browser/fixture-contracts.js';

function isObservationRegistry(value: unknown): value is FixtureObservationRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('features' in value) || !('ports' in value)) return false;
  return typeof value.features === 'object' && value.features !== null && !Array.isArray(value.features)
    && typeof value.ports === 'object' && value.ports !== null && !Array.isArray(value.ports);
}

function registry(): FixtureObservationRegistry {
  const existing: unknown = Reflect.get(globalThis, 'fixtureApp');
  if (existing !== undefined) {
    if (!isObservationRegistry(existing)) throw new Error('Invalid application fixture registry');
    return existing;
  }
  const created: FixtureObservationRegistry = { features: {}, ports: {} };
  Reflect.set(globalThis, 'fixtureApp', created);
  return created;
}

export function observeFeature<K extends FixtureFeatureName>(
  name: K,
  factoryName: string,
  create: (...args: Parameters<FixtureFactories[K]>) => FixtureFeatures[K],
  ...args: Parameters<FixtureFactories[K]>
): FixtureFeatures[K] {
  const fixture = registry();
  if (Object.hasOwn(fixture.features, name)) throw new Error(`Duplicate application feature: ${name}`);
  if (FEATURE_FACTORY_NAMES[name] !== factoryName) {
    throw new Error(`Application feature ${name} expected ${FEATURE_FACTORY_NAMES[name]}, received ${factoryName}`);
  }
  const value = create(...args);
  Reflect.set(fixture.features, name, value);
  Reflect.set(fixture.ports, name, args[0]);
  return value;
}

function hasAllFeatures(value: Partial<FixtureFeatures>): value is FixtureFeatures {
  return FIXTURE_FEATURE_NAMES.every(name => Object.hasOwn(value, name));
}

function hasAllPorts(value: Partial<FixturePorts>): value is FixturePorts {
  return FIXTURE_PORT_NAMES.every(name => Object.hasOwn(value, name));
}

export function completeFixtureObservation(): FixtureRegistry {
  const fixture = registry();
  if (!hasAllFeatures(fixture.features)) {
    const missing = FIXTURE_FEATURE_NAMES.filter(name => !Object.hasOwn(fixture.features, name));
    throw new Error(`Application fixture missed features: ${missing.join(', ')}`);
  }
  if (!hasAllPorts(fixture.ports)) {
    const missing = FIXTURE_PORT_NAMES.filter(name => !Object.hasOwn(fixture.ports, name));
    throw new Error(`Application fixture missed ports: ${missing.join(', ')}`);
  }
  const complete: FixtureRegistry = { features: fixture.features, ports: fixture.ports };
  Reflect.set(globalThis, 'fixtureApp', complete);
  return complete;
}
