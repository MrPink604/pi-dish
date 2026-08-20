/**
 * Optional OMP custom-share handler.
 *
 * Symlink this file to ~/.omp/agent/share.mjs. OMP's built-in /share first
 * creates its native live HTML export (including system prompt and active
 * tools), then calls this function. The exact snapshot is stored and served
 * by pi-dish instead of being uploaded to OMP's default share service.
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
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    throw new Error(result?.error || `pi-dish share import failed (${response.status})`);
  }

  return {
    url: result.url || new URL(result.path, baseUrl).href,
    message: 'Shared through pi-dish',
  };
}
