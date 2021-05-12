const process = require('process');
const fs = require('fs');
const contextPayload = JSON.stringify(require('./test-context.json'));

if (!('INPUT_TOKEN' in process.env)) {
    console.log('In order to test this action you must set INPUT_TOKEN to a valid Github token');
    process.exit(-1);
}
process.env.INPUT_VERBOSE = 'true';
process.env.GITHUB_REPOSITORY = 'westonpace/pr-needs-review';

fs.writeFileSync('/tmp/foo.json', contextPayload, { encoding: 'utf-8' });
process.env.GITHUB_EVENT_PATH = '/tmp/foo.json';

require('./index.js');