const { SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG } = require('constants');
const process = require('process');

if (!('INPUT_TOKEN' in process.env)) {
    console.log('In order to run this test you must set INPUT_TOKEN to a valid Github token');
    process.exit(-1);
}

const payload = require('./test-context.json');
const readyForReviewLabel = 'awaiting-review';

async function run() {
    const lib = require('./lib.js');
    lib.configure({ owner: 'westonpace', repo: 'pr-needs-review' }, process.env['INPUT_TOKEN'], true);
    if (!lib.isDraft(payload.pull_request)) {
        console.log('Is not draft');
        await lib.ensureLabel(payload.pull_request, readyForReviewLabel);
    } else {
        console.log('Is draft');
    }
}

run().catch(err => {
    console.log(err);
});