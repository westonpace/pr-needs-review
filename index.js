const core = require('@actions/core');
const github = require('@actions/github');

const lib = require('./lib.js');

const MAX_POLL_ATTEMPTS = 5
const POLL_BACKOFF_MS = 30

const verbose = 'true' === core.getInput('verbose').toLowerCase();
const myToken = core.getInput('token');
const octokit = github.getOctokit(myToken);
const payload = github.context.payload;
const repo = github.context.repo;

lib.configure(repo, myToken, verbose);

const readyForReviewLabel = 'awaiting-review';
const needsChangesLabel = 'awaiting-changes';
const blessChangesComment = `I have made the requested changes; please review again`;
const needsChangesComment = `
Your PR has received a review that is requesting changes.  Please make the changes requested.
 Once you have done this please leave a comment on this pull request containing the phrase
 \`I have made the requested changes; please review again\`.  This will relabel the pull
 request to let reviewers know the changes have been completed.
`.trim().replace(/\n/g, '');

async function doUpdate(pr) {
    await lib.updatePr(pr.number, blessChangesComment, needsChangesComment, readyForReviewLabel, needsChangesLabel);
}

async function handleIssueComment() {
    if (payload.comment.body.toLowerCase().includes(blessChangesComment.toLowerCase())) {
        console.log('A `bless` comment was posted to the PR.  Potentially updating PR status');
        await doUpdate(payload.issue);
    } else {
        console.log('An unrelated comment was posted to the PR, ignoring.');
    }
}

async function handlePrOpened() {
    // When a PR is opened:
    // * If the PR is not in draft then mark it ready for review
    console.log('A PR was opened.  Potentially updating PR status.');
    await doUpdate(payload.pull_request);
}

async function handleReadyForReview() {
    // Converting to review won't clear awaiting-changes but it can add awaiting-review
    console.log('A PR was moved out of the draft state.  Potentially updating PR status');
    await doUpdate(payload.pull_request);
}

async function handleConvertedToDraft() {
    console.log('A PR was moved into the draft state.  Removing any ready for review label');
    await doUpdate(payload.pull_request);
}

async function handlePrReview() {
    console.log('A PR review was posted to the PR.  Potentially updating PR status');
    await doUpdate(payload.pull_request);
}

async function run() {
    try {
        if ('pull_request' in payload) {
            if ('review' in payload) {
                // PR Review
                await handlePrReview();
            } else {
                //PR action
                if (payload.action === 'opened') {
                    await handlePrOpened();
                } else if (payload.action === 'ready_for_review') {
                    await handleReadyForReview();
                } else if (payload.action === 'converted_to_draft') {
                    await handleConvertedToDraft();
                } else {
                    console.log(`Unexpected action type ${payload.action}`);
                }
            }
        } else if ('comment' in payload) {
            await handleIssueComment();
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run().catch(err => {
    core.setFailed(err.message);
});

