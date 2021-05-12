const core = require('@actions/core');
const github = require('@actions/github');

const MAX_POLL_ATTEMPTS = 5
const POLL_BACKOFF_MS = 30

let verbose = false;
let octokit = null;
let repo = null;

function log(msg) {
    console.log(msg);
}

function trace(msg) {
    if (verbose) {
        console.log(msg);
    }
}

function error(msg) {
    console.error(msg);
}

async function getPr(prNumber) {
    trace(`Fetching PR ${prNumber}`);
    return expectSuccess(await octokit.rest.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
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
        owner: repo.owner,
        repo: repo.repo,
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
        } else if (verbose) {
            trace(` - Skipping unrelated comment with id ${comment.id}`);
        }
    }
    if (timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        log(`Change last blessed at ${lastTimestamp}`)
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
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        labels: [label]
    }));
}

async function removeLabel(prNumber, label) {
    log(`Removing the label ${label} from issue ${prNumber}`);
    expectSuccess(await octokit.rest.issues.removeLabel({
        owner: repo.owner,
        repo: repo.repo,
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
        owner: repo.owner,
        repo: repo.repo,
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
        owner: repo.owner,
        repo: repo.repo,
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
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        body
    }));
}

async function doesPrNeedChanges(prNumber, blessComment, needsChangesComment) {
    const lastBlessed = await getTimestampOfLastCommentContaining(prNumber, blessComment, needsChangesComment)
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

module.exports = {
    configure: (repo_, token, verbose_) => {
        repo = repo_;
        verbose = verbose_;
        octokit = github.getOctokit(token);
    },
    isDraft,
    ensureLabel,
    hasLabel,
    updatePr
};