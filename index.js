const core = require('@actions/core');
const github = require('@actions/github');
BLAH
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
const needsChangesComment = `
Your PR has received a review that is requesting changes.  Please make the changes requested.
 Once you have done this please leave a comment on this pull request containing the phrase
 \`I have made the requested changes; please review again\`.  This will relabel the pull
 request to let reviewers know the changes have been completed.
`.trim().replace('\n', '');

// async function handleIssueComment() {
//     if (isReadyForReviewComment(payload.comment) && isPrIssue(payload.issue)) {
//         let currentStatus = getCurrentIssueLabelStatus(payload.issue);
//         if (currentStatus.unstable || !currentStatus.readyForReview) {
//             return updatePrStatus(payload.issue.number);
//         }
//     }
// }

async function handlePrOpened() {
    // When a PR is opened:
    // * If the PR is not in draft then mark it ready for review
    if (!lib.isDraft(payload.pull_request)) {
        console.log('Is not draft');
        await lib.ensureLabel(payload.pull_request, readyForReviewLabel);
    } else {
        console.log('Is draft');
    }
}

async function handleReadyForReview() {
    // Converting to review won't clear awaiting-changes but it can add awaiting-review
    if (!lib.hasLabel(payload.pull_request, needsChangesLabel)) {
        console.log('Does not need changes')
        await lib.ensureLabel(payload.pull_request, readyForReviewLabel);
    } else {
        console.log('Needs changes');
    }
}

async function handleConvertedToDraft() {
    console.log('Ensuring label removed')
    await lib.ensureLabel(payload.pull_request, readyForReviewLabel, false);
}

async function handlePrReview() {
    const approvalStatusByAuthor = await lib.getApprovalStatusByAuthor(payload.pull_request.number);
    const needsChanges = lib.isNeedsChanges(payload.review);
    for (const author of Object.keys(approvalStatusByAuthor)) {
        if (approvalStatusByAuthor[author]) {
            console.log(`Approved by ${author}`);
        } else if (approvalStatusByAuthor[author] === false) {
            console.log(`Needs changes from ${author}`);
            needsChanges = true;
        } else {
            console.log(`Pending review from ${author}`);
        }
    }
    if (needsChanges) {
        console.log(`Needs changes`);
        if (lib.hasLabel(payload.pull_request, readyForReviewLabel)) {
            console.log(`Did not previously need changes`);
            await lib.addComment(payload.pull_request.number, needsChangesComment);
        } else {
            console.log(`Already needed changes`);
        }
        await lib.ensureLabel(payload.pull_request, needsChangesLabel);
        await lib.ensureLabel(payload.pull_request, readyForReviewLabel, false);
    } else {
        console.log(`Does not need changes`);
        await lib.ensureLabel(payload.pull_request, readyForReviewLabel);
        await lib.ensureLabel(payload.pull_request, needsChangesLabel, false);
    }
}

async function run() {
    try {
        payload_str = JSON.stringify(github.context.payload, undefined, 2);
        console.log(`The event payload: ${payload_str}`);

        console.log('Checking action');
        if ('pull_request' in payload) {
            if ('review' in payload) {
                // PR Review
                console.log('Is PR review');
                handlePrReview();
            } else {
                //PR action
                console.log('Is pull_request action');
                if (payload.action === 'opened') {
                    console.log('Is opened action');
                    handlePrOpened();
                } else if (payload.action === 'ready_for_review') {
                    handleReadyForReview();
                } else if (payload.action === 'converted_to_draft') {
                    handleConvertedToDraft();
                }
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

