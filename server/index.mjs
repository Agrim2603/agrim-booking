import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';

try {
  const config = loadConfig();
  const app = await createApp(config);
  app.server.listen(config.port, config.host, () => console.log(`Booking website: ${config.origin}\nAdmin dashboard: ${config.origin}/dashboard`));
  app.server.on('error', error => { console.error('Server could not start:', error.code || error.message); process.exit(1); });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    await app.close(); clearTimeout(deadline); process.exit(0);
  });
} catch (error) { console.error(error.message); process.exit(1); }
