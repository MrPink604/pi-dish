// Generated test/tool from test/fixtures/browser-feature-probe.mts; edit that source and run npm run build:tests.
import { FEATURE_FACTORY_NAMES, FIXTURE_FEATURE_NAMES, FIXTURE_PORT_NAMES, } from '../browser/fixture-contracts.js';
function isObservationRegistry(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    if (!('features' in value) || !('ports' in value))
        return false;
    return typeof value.features === 'object' && value.features !== null && !Array.isArray(value.features)
        && typeof value.ports === 'object' && value.ports !== null && !Array.isArray(value.ports);
}
function registry() {
    const existing = Reflect.get(globalThis, 'fixtureApp');
    if (existing !== undefined) {
        if (!isObservationRegistry(existing))
            throw new Error('Invalid application fixture registry');
        return existing;
    }
    const created = { features: {}, ports: {} };
    Reflect.set(globalThis, 'fixtureApp', created);
    return created;
}
export function observeFeature(name, factoryName, create, ...args) {
    const fixture = registry();
    if (Object.hasOwn(fixture.features, name))
        throw new Error(`Duplicate application feature: ${name}`);
    if (FEATURE_FACTORY_NAMES[name] !== factoryName) {
        throw new Error(`Application feature ${name} expected ${FEATURE_FACTORY_NAMES[name]}, received ${factoryName}`);
    }
    const value = create(...args);
    Reflect.set(fixture.features, name, value);
    Reflect.set(fixture.ports, name, args[0]);
    return value;
}
function hasAllFeatures(value) {
    return FIXTURE_FEATURE_NAMES.every(name => Object.hasOwn(value, name));
}
function hasAllPorts(value) {
    return FIXTURE_PORT_NAMES.every(name => Object.hasOwn(value, name));
}
export function completeFixtureObservation() {
    const fixture = registry();
    if (!hasAllFeatures(fixture.features)) {
        const missing = FIXTURE_FEATURE_NAMES.filter(name => !Object.hasOwn(fixture.features, name));
        throw new Error(`Application fixture missed features: ${missing.join(', ')}`);
    }
    if (!hasAllPorts(fixture.ports)) {
        const missing = FIXTURE_PORT_NAMES.filter(name => !Object.hasOwn(fixture.ports, name));
        throw new Error(`Application fixture missed ports: ${missing.join(', ')}`);
    }
    const complete = { features: fixture.features, ports: fixture.ports };
    Reflect.set(globalThis, 'fixtureApp', complete);
    return complete;
}
