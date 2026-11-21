export {};
if (process.argv.includes('--ignore-sighup')) process.on('SIGHUP', () => {});
if (process.connected) process.once('disconnect', () => process.exit(0));
setInterval(() => {}, 1 << 30);
