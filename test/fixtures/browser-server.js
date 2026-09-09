// Started only by the browser fixture, with a sanitized environment and HOME.
const server = require('../../server');
const ready = () => process.send({ base: `http://127.0.0.1:${server.address().port}` });
if (server.listening) ready();
else server.once('listening', ready);
