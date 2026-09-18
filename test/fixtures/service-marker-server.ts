import * as fs from 'node:fs';

const marker = process.env.PI_DISH_SERVICE_MARKER;
if (!marker) throw new Error('Service marker fixture requires PI_DISH_SERVICE_MARKER');
fs.writeFileSync(marker, String(process.pid));
setInterval(() => {}, 1000);
