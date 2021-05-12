const core = require('@actions/core');
const github = require('@actions/github');

const repoOwner = core.getInput('dummyRepoOwner');
const repoName = core.getInput('dummyRepoName');
const myToken = core.getInput('dummyRepoToken');
const myAltToken = core.getInput('dummyRepoAltToken');
const octokit = github.getOctokit(myToken);
const octokitAlt = github.getOctokit(myAltToken);
const lib = require('../lib.js');
lib.configure({ owner: repoOwner, repo: repoName }, myToken, true);

const BLESS_COMMENT = 'bless this pr';
const NEEDS_CHANGES_COMMENT = 'make changes then ' + BLESS_COMMENT;
const READY_FOR_REVIEW_LABEL = 'rfr';
const NEEDS_CHANGES_LABEL = 'nc';

function aok(rsp) {
    if (rsp.status < 200 || rsp.status > 299) {
        error('Expected request to succeed but got error response');
        error(JSON.stringify(rsp, null, 2));
        throw Error('A request that was expected to succeed failed.  See logs for details');
    }
    return rsp;
}

function doUpdate(prNumber) {
    return lib.updatePr(prNumber, BLESS_COMMENT, NEEDS_CHANGES_COMMENT, READY_FOR_REVIEW_LABEL, NEEDS_CHANGES_LABEL);
}

async function cleanup() {
    console.log('Cleaning up leftover PRs');
    for (const pull of aok(await octokit.pulls.list({
        owner: repoOwner,
        repo: repoName
    })).data) {
        aok(await octokit.pulls.update({
            owner: repoOwner,
            repo: repoName,
            pull_number: pull.number,
            state: 'closed'
        }));
    }
}

async function openDummyPr(draft = false) {
    console.log('Creating dummy PR');
    return aok(await octokit.pulls.create({
        owner: repoOwner,
        repo: repoName,
        head: 'feature/some_feature',
        base: 'main',
        title: 'Dummy pull request for testing',
        draft
    })).data.number;
}

async function requestChanges(prNumber) {
    console.log('Requested changes on PR');
    return aok(await octokitAlt.pulls.createReview({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        event: 'REQUEST_CHANGES',
        body: 'Needs changes'
    }));
}

async function undraftPr(prNumber) {
    // Does not work
    console.log('Undrafting pr');
    return aok(await octokit.pulls.update({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        draft: false
    }));
}

async function blessPr(prNumber) {
    console.log('Blessing PR');
    return aok(await octokit.issues.createComment({
        owner: repoOwner,
        repo: repoName,
        issue_number: prNumber,
        body: BLESS_COMMENT
    }));
}

async function assertLabel(prNumber, label, expected = true) {
    const pr = aok(await octokit.pulls.get({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber
    })).data;
    if (lib.hasLabel(pr, label) != expected) {
        if (expected) {
            throw Error(`Expected the PR ${prNumber} to have the label ${label} and it did not`);
        } else {
            throw Error(`Expected the PR ${prNumber} to not have the label ${label} and it did`);
        }
    }
}

async function assertHasNeedsChangesComment(prNumber, expected = true) {
    const comments = aok(await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repoOwner,
        repo: repoName,
        issue_number: prNumber
    })).data;
    const matchingComments = comments.filter(comment => comment.body === NEEDS_CHANGES_COMMENT)
    if (expected) {
        if (matchingComments.length !== 1) {
            throw Error(`Expected the PR ${prNumber} to have exactly one "needs changes" comment but it had ${matchingComments.length}`);
        }
    } else {
        if (matchingComments.length !== 0) {
            throw Error(`Expected the PR ${prNumber} to have no "needs changes" comments but it had ${matchingComments.length}`);
        }
    }
}

async function testNewPr() {
    const dummyPrNumber = await openDummyPr();
    await doUpdate(dummyPrNumber);
    await assertLabel(dummyPrNumber, READY_FOR_REVIEW_LABEL);
    await assertLabel(dummyPrNumber, NEEDS_CHANGES_LABEL, false);
}

async function testDraftPr() {
    const dummyPrNumber = await openDummyPr(draft = true);
    await doUpdate(dummyPrNumber);
    await assertLabel(dummyPrNumber, READY_FOR_REVIEW_LABEL, false);
    await assertLabel(dummyPrNumber, NEEDS_CHANGES_LABEL, false);
    // TODO: No way to undraft a PR via the API
    /*await undraftPr(dummyPrNumber);
    await doUpdate(dummyPrNumber);
    await assertLabel(dummyPrNumber, READY_FOR_REVIEW_LABEL, true);*/
}

async function testNeedsChangesClearedByComment() {
    const dummyPrNumber = await openDummyPr();
    await assertHasNeedsChangesComment(dummyPrNumber, false);
    await doUpdate(dummyPrNumber);
    await requestChanges(dummyPrNumber);
    await doUpdate(dummyPrNumber);
    await assertLabel(dummyPrNumber, READY_FOR_REVIEW_LABEL, false);
    await assertLabel(dummyPrNumber, NEEDS_CHANGES_LABEL);
    await assertHasNeedsChangesComment(dummyPrNumber);
    await blessPr(dummyPrNumber);
    await doUpdate(dummyPrNumber);
    await assertLabel(dummyPrNumber, READY_FOR_REVIEW_LABEL);
    await assertLabel(dummyPrNumber, NEEDS_CHANGES_LABEL, false);
    await assertHasNeedsChangesComment(dummyPrNumber);
}

async function run() {
    try {
        await cleanup();
        await testNewPr();
        await cleanup();
        await testDraftPr();
        await cleanup();
        await testNeedsChangesClearedByComment();
    } catch (error) {
        console.log(error.stack);
        core.setFailed(error.message);
    }
}

run().catch(err => {
    core.setFailed(err.message);
});
