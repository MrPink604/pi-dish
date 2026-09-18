export {};
if (process.argv.includes('--ignore-sighup')) process.on('SIGHUP', () => {});
setInterval(() => {}, 1 << 30);
