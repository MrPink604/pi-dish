// Generated edge from extensions/pi-dish-share-omp.mts; edit that source and run npm run build:edges.
/**
 * Optional OMP custom-share handler.
 *
 * Symlink the emitted pi-dish-share-omp.mjs to ~/.omp/agent/share.mjs. OMP's
 * built-in /share first creates its native live HTML export (including system
 * prompt and active tools), then calls this function. pi-dish stores that exact
 * snapshot instead of uploading it to OMP's default share service.
 */
import { readFile } from 'node:fs/promises';
export default async function shareThroughPiDish(htmlPath) {
    const baseUrl = process.env.PI_DISH_URL;
    if (!baseUrl) {
        throw new Error('PI_DISH_URL is not set. Start this OMP session through pi-dish or set it to the pi-dish server URL.');
    }
    const endpoint = new URL('/api/shares/import', baseUrl);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: await readFile(htmlPath),
    });
    let result;
    try {
        result = await response.json();
    }
    catch {
        result = null;
    }
    const record = result && typeof result === 'object' ? result : null;
    if (!response.ok) {
        const error = record && 'error' in record && typeof record.error === 'string' ? record.error : null;
        throw new Error(error || `pi-dish share import failed (${response.status})`);
    }
    const url = record && 'url' in record && typeof record.url === 'string' ? record.url : null;
    const relativePath = record && 'path' in record && typeof record.path === 'string' ? record.path : null;
    if (!url && !relativePath)
        throw new Error('pi-dish share import returned no URL or path');
    return {
        url: url || new URL(relativePath, baseUrl).href,
        message: 'Shared through pi-dish',
    };
}
