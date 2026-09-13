import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { MinidspClient } from './minidspClient.js';

export function attachWsRelay(httpServer: HttpServer, client: MinidspClient): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const unsubscribe = client.onStatus((status) => {
    const payload = JSON.stringify({ type: 'status', ...status });
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  });

  wss.on('close', unsubscribe);

  return wss;
}
