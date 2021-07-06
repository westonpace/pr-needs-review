const core = require('@actions/core');
const github = require('@actions/github');

const MAX_POLL_ATTEMPTS = 5
const POLL_BACKOFF_MS = 30

const verbose = 'true' === core.getInput('verbose').toLowerCase();
const myToken = core.getInput('token');
const octokit = github.getOctokit(myToken);
const payload = github.context.payload;
const repo = github.context.repo;

const readyForReviewLabel = 'awaiting-review';

async function handleIssueComment() {
    if (isReadyForReviewComment(payload.comment) && isPrIssue(payload.issue)) {
        let currentStatus = getCurrentIssueLabelStatus(payload.issue);
        if (currentStatus.unstable || !currentStatus.readyForReview) {
            return updatePrStatus(payload.issue.number);
        }
    }
}

async function handlePrOpened() {
    // When a PR is opened:
    // * If the PR is not in draft then mark it ready for review
    if (!isDraft(payload.pull_request)) {
        ensureLabel(payload.pull_request.number, readyForReviewLabel);
    }
}

async function run() {
    try {
        payload_str = JSON.stringify(github.context.payload, undefined, 2);
        console.log(`The event payload: ${payload_str}`);

        if ('pull_request' in payload) {
            if (payload.action === 'opened') {
                handlePrOpened();
            }
        }

        let err;
        // if ('comment' in payload) {
        //     err = await handleIssueComment();
        // }

        if (err) {
            core.setFailed(err);
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

run().catch(err => {
    core.setFailed(err.message);
});

