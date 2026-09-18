// Started by browser fixtures only, with a sanitized environment and HOME.
import fs = require('node:fs');
import net = require('node:net');
import path = require('node:path');
import { isRecord } from '../../lib/wire-protocol.js';

(async () => {
  if (process.env.PI_DISH_TEST_LIVE_SESSION) {
    const id = process.env.PI_DISH_TEST_LIVE_SESSION;
    const home = process.env.HOME;
    if (!home) throw new Error('Browser fixture requires HOME');
    const socketPath = path.join(home, 'bridge.sock');
    const sessionFile = path.join(home, '.pi/agent/sessions/project', `${id}.jsonl`);
    const clients = new Set<net.Socket>();
    const ui = new Map<string, unknown>();
    let turnInProgress = false;
    const eventLine = (event: unknown, data: unknown) => JSON.stringify({ type: 'event', event, data }) + '\n';
    const bridge = net.createServer(socket => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      socket.on('error', () => clients.delete(socket));
      socket.write(JSON.stringify({ type: 'hello', turnInProgress, queue: { steering: [], followUp: [] } }) + '\n');
      for (const request of ui.values()) socket.write(eventLine('extension_ui_request', request));
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const message: unknown = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (!isRecord(message)) throw new Error('Invalid browser fixture command');
          process.send?.({ type: 'command', message });
          if (message.command === 'extension_ui_response') ui.delete(String(message.requestId));
          const data = message.command === 'get_available_models' ? { models: [] }
            : message.command === 'get_commands' ? [] : {};
          socket.write(JSON.stringify({ type: 'response', id: message.id, success: true, data }) + '\n');
        }
      });
    });
    await new Promise<void>(resolve => bridge.listen(socketPath, resolve));
    const registry = path.join(home, '.pi/dish/sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, `${id}.json`), JSON.stringify({
      sessionId: id, sessionFile, socketPath, pid: process.pid, cwd: '/fixture/project', name: 'Live fixture',
    }));
    process.on('message', (message: unknown) => {
      if (!isRecord(message)) throw new Error('Invalid browser fixture event');
      const { event, data, entry } = message;
      if (entry) fs.appendFileSync(sessionFile, JSON.stringify(entry) + '\n');
      if (event === 'turn_start') turnInProgress = true;
      if (event === 'turn_end' || event === 'agent_end') turnInProgress = false;
      const value = isRecord(data) ? data : {};
      if (event === 'extension_ui_request') ui.set(String(value.id || value.widgetKey || value.statusKey), data);
      if (event === 'extension_ui_resolved') ui.delete(String(value.id));
      if (event) for (const socket of clients) socket.write(JSON.stringify({ type: 'event', event, data }) + '\n');
    });
  }
  const server: import('node:http').Server = require('../../server');
  const ready = () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Browser fixture server lacks a TCP address');
    process.send?.({ base: `http://127.0.0.1:${address.port}` });
  };
  if (server.listening) ready();
  else server.once('listening', ready);
})().catch(error => { console.error(error); process.exitCode = 1; });

export {};
