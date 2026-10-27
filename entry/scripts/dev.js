// Accept preview-runner arguments while keeping npm start unchanged.
const portIndex = process.argv.indexOf('--port');
const hostIndex = process.argv.indexOf('--host');
if (portIndex >= 0) {
  const port = Number(process.argv[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
  process.env.PORT = String(port);
}
if (hostIndex >= 0) process.env.HOST = process.argv[hostIndex + 1];
await import('../server.js');
