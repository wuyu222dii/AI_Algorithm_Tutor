#!/usr/bin/env node
import { createServer } from 'node:http';

const port = Number(process.env.REDIS_MOCK_PORT ?? 8079);
const token = process.env.REDIS_MOCK_TOKEN ?? 'ci-redis-token';

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    try {
      const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(command) || command[0] !== 'PING') {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'unsupported_command' }));
        return;
      }
      response.end(JSON.stringify({ result: 'PONG' }));
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'invalid_json' }));
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`[redis-rest-smoke] listening on ${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
