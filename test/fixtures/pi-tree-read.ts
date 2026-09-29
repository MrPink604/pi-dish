import { getSessionTree } from '../../lib/pi-sdk.js';

// A corrupt ancestry must not be able to hang the parent regression runner.
void getSessionTree(process.argv[2]).then(tree => {
  process.stdout.write(JSON.stringify(tree));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
