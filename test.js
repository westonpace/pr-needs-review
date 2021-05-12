const { SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG } = require('constants');
const process = require('process');

if (!('INPUT_TOKEN' in process.env)) {
    console.log('In order to run this test you must set INPUT_TOKEN to a valid Github token');
    process.exit(-1);
}


async function run() {
    const lib = require('./lib.js');
    lib.configure({ owner: 'apache', repo: 'arrow' }, process.env['INPUT_TOKEN'], true);
    const openPrs = await lib.getOpenPrs();
    for (let openPr of openPrs) {
        console.log(`Checking Open PR ${openPr.number}`);
        await lib.updatePrStatus(openPr.number);
    }
}

run().catch(err => {
    console.log(err);
});