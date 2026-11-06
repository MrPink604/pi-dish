/**
 * Optional OMP custom-share handler.
 *
 * Symlink the emitted pi-dish-share-omp.mjs to ~/.omp/agent/share.mjs. OMP's
 * built-in /share first creates its native live HTML export (including system
 * prompt and active tools), then calls this function. pi-dish stores that exact
 * snapshot instead of uploading it to OMP's default share service.
 */
import { readFile } from 'node:fs/promises';

export default async function shareThroughPiDish(htmlPath: string): Promise<{ url: string; message: string }> {
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
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  const body = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === 'string' ? body.error : null;
    throw new Error(error || `pi-dish share import failed (${response.status})`);
  }

  const url = typeof body.url === 'string' ? body.url : null;
  const relativePath = typeof body.path === 'string' ? body.path : null;
  if (!url && !relativePath) throw new Error('pi-dish share import returned no URL or path');
  return {
    url: url || new URL(relativePath!, baseUrl).href,
    message: 'Shared through pi-dish',
  };
}
