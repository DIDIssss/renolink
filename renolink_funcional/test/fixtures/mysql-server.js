'use strict';
// A real application process, bound to loopback, used only by the integration test.
require('../../server').start().then(({ server }) => {
  const ready = () => process.send({ port: server.address().port });
  if (server.listening) ready(); else server.once('listening', ready);
}).catch(() => { process.exitCode = 1; if (process.connected) process.disconnect(); });
