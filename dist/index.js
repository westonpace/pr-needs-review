'use strict';

var prNeedsReview = {};

require('@actions/core');
const github$1 = require('@actions/github');

let verbose$1 = false;
let octokit = null;
let repo$1 = null;

function log(msg) {
    console.log(msg);
}

function trace(msg) {
    if (verbose$1) {
        console.log(msg);
    }
}

function error(msg) {
    console.error(msg);
}

async function getPr(prNumber) {
    trace(`Fetching PR ${prNumber}`);
    return expectSuccess(await octokit.rest.pulls.get({
        owner: repo$1.owner,
        repo: repo$1.repo,
        pull_number: prNumber
    })).data;
}

function expectSuccess(rsp) {
    if (rsp.status < 200 || rsp.status > 299) {
        error('Expected request to succeed but got error response');
        error(JSON.stringify(rsp, null, 2));
        throw Error('A request that was expected to succeed failed.  See logs for details');
    }
    return rsp;
}

async function getComments(prNumber) {
    trace(`Fetching comments for issue: ${prNumber}`);
    const commentsRsp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo$1.owner,
        repo: repo$1.repo,
        issue_number: prNumber
    });
    return commentsRsp.data;
}

async function getTimestampOfLastCommentContaining(prNumber, commentStr, bodyToIgnore) {
    const comments = await getComments(prNumber);
    trace(`Retrieved ${comments.length} comments on PR: ${prNumber}`);
    const timestamps = [];
    for (const comment of comments) {
        if (comment.body.toLowerCase().includes(commentStr.toLowerCase()) && comment.body.toLowerCase() !== bodyToIgnore) {
            timestamps.push(Date.parse(comment.updated_at));
            log(` - Changes blessed at ${comment.updated_at}`);
        } else if (verbose$1) {
            trace(` - Skipping unrelated comment with id ${comment.id}`);
        }
    }
    if (timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        log(`Change last blessed at ${lastTimestamp}`);
        return lastTimestamp;
    }
    return null;
}

function hasLabel(issue, label) {
    for (let l of issue.labels) {
        if (l.name.toLowerCase() == label.toLowerCase()) {
            trace(`The issue ${issue.number} does have the label ${label}`);
            return true;
        }
    }
    trace(`The issue ${issue.number} does not have the label ${label}`);
    return false;
}

function isDraft(pull_request) {
    return pull_request.draft;
}

async function addLabel(prNumber, label) {
    log(`Adding the label ${label} to issue ${prNumber}`);
    expectSuccess(await octokit.rest.issues.addLabels({
        owner: repo$1.owner,
        repo: repo$1.repo,
        issue_number: prNumber,
        labels: [label]
    }));
}

async function removeLabel(prNumber, label) {
    log(`Removing the label ${label} from issue ${prNumber}`);
    expectSuccess(await octokit.rest.issues.removeLabel({
        owner: repo$1.owner,
        repo: repo$1.repo,
        issue_number: prNumber,
        name: label
    }));
}

async function ensureLabel(issue, label, expected = true) {
    if (hasLabel(issue, label) == expected) {
        if (expected) {
            trace(`The issue ${issue.number} already had the label ${label} so no change is needed`);
        } else {
            trace(`The issue ${issue.number} already did not have the label ${label} so no change is needed`);
        }
        return;
    }
    if (expected) {
        await addLabel(issue.number, label);
    } else {
        await removeLabel(issue.number, label);
    }
}

function isApprove(review) {
    return review.state.toLowerCase() === 'approved';
}

function isIndicative(review) {
    return review.state.toLowerCase() !== 'commented';
}

function reviewIsAfter(review, since) {
    const submitted_at = Date.parse(review.submitted_at);
    return submitted_at >= since;
}

async function getApprovalStatusByAuthor(prNumber, since = null) {
    let reviews = expectSuccess(await octokit.rest.pulls.listReviews({
        owner: repo$1.owner,
        repo: repo$1.repo,
        pull_number: prNumber
    })).data;
    const approvedByAuthor = {};
    trace(`The PR ${prNumber} had ${reviews.length} reviews`);
    if (since) {
        reviews = reviews.filter(review => reviewIsAfter(review, since));
        trace(`${reviews.length} of those reviews have not been blessed by a comment yet`);
    }
    for (const review of reviews) {
        trace(`  Reviewer ${review.user.login}`);
        if (isIndicative(review)) {
            trace(`    Indicative and approved=${isApprove(review)}`);
            approvedByAuthor[review.user.login] = isApprove(review);
        }
    }
    const pendingReviews = expectSuccess(await octokit.rest.pulls.listRequestedReviewers({
        owner: repo$1.owner,
        repo: repo$1.repo,
        pull_number: prNumber
    })).data;
    trace(`There are ${pendingReviews.users.length} pending reviews`);
    for (const user of pendingReviews.users) {
        log(`Ignoring any previous reviews from ${user.login} since a review is pending`);
        approvedByAuthor[user.login] = null;
    }
    return approvedByAuthor;
}

async function addComment(prNumber, body) {
    await expectSuccess(await octokit.rest.issues.createComment({
        owner: repo$1.owner,
        repo: repo$1.repo,
        issue_number: prNumber,
        body
    }));
}

async function doesPrNeedChanges(prNumber, blessComment, needsChangesComment) {
    const lastBlessed = await getTimestampOfLastCommentContaining(prNumber, blessComment, needsChangesComment);
    const approvalStatusByAuthor = await getApprovalStatusByAuthor(prNumber, lastBlessed);
    let needsChanges = false;
    for (const author of Object.keys(approvalStatusByAuthor)) {
        if (approvalStatusByAuthor[author] === false) {
            log(`Needs changes from ${author}`);
            needsChanges = true;
        }
    }
    return needsChanges;
}

async function ensurePrState(pr, needsChanges, needsChangesComment, readyForReviewLabel, needsChangesLabel) {
    if (needsChanges) {
        if (hasLabel(pr, readyForReviewLabel)) {
            log(`PR did not previously need changes.  Adding comment describing process`);
            await addComment(pr.number, needsChangesComment);
        } else {
            trace(`The PR already needed changes`);
        }
        await ensureLabel(pr, needsChangesLabel);
        await ensureLabel(pr, readyForReviewLabel, false);
    } else {
        trace(`The PR does not need changes and should be awaiting review`);
        await ensureLabel(pr, readyForReviewLabel);
        await ensureLabel(pr, needsChangesLabel, false);
    }
}

async function updatePr(prNumber, blessComment, needsChangesComment, readyForReviewLabel, needsChangesLabel) {
    const pr = await getPr(prNumber);
    if (pr.draft) {
        log('Draft PR.  Ensuring ready for review label is not present');
        await ensureLabel(pr, readyForReviewLabel, false);
        return;
    }
    const needsChanges = await doesPrNeedChanges(prNumber, blessComment, needsChangesComment);
    await ensurePrState(pr, needsChanges, needsChangesComment, readyForReviewLabel, needsChangesLabel);
}

var lib$1 = {
    configure: (repo_, token, verbose_) => {
        repo$1 = repo_;
        verbose$1 = verbose_;
        octokit = github$1.getOctokit(token);
    },
    isDraft,
    ensureLabel,
    hasLabel,
    updatePr
};

const core = require('@actions/core');
const github = require('@actions/github');

const lib = lib$1;

const verbose = 'true' === core.getInput('verbose').toLowerCase();
const myToken = core.getInput('token');
github.getOctokit(myToken);
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

module.exports = prNeedsReview;
