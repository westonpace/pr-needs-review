const process = require('process');

if (!('INPUT_TOKEN' in process.env)) {
    console.log('In order to run this test you must set INPUT_TOKEN to a valid Github token');
    process.exit(-1);
}

if (!('INPUT_ALTTOKEN' in process.env)) {
    console.log('In order to run this test you must set INPUT_ALTTOKEN to a valid Github token');
    process.exit(-1);
}

process.env['INPUT_DUMMYREPOOWNER'] = 'westonpace';
process.env['INPUT_DUMMYREPONAME'] = 'pr-needs-review-dummy-repo';
process.env['INPUT_DUMMYREPOTOKEN'] = process.env['INPUT_TOKEN'];
process.env['INPUT_DUMMYREPOALTTOKEN'] = process.env['INPUT_ALTTOKEN'];

require('./test-check/index.js');
