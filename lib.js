const core = require('@actions/core');
const github = require('@actions/github');

const MAX_POLL_ATTEMPTS = 5
const POLL_BACKOFF_MS = 30

let verbose = false;
let octokit = null;
let repo = null;

function delay(delay_ms) {
    return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

function isReadyForReviewComment(comment) {
    return comment.body.toLowerCase().includes('ready for review');
}

function expectSuccess(rsp) {
    if (rsp.status != 200) {
        console.error('Expected request to succeed but got error response');
        console.error(JSON.stringify(rsp, null, 2));
        throw Error('A request that was expected to succeed failed.  See logs for details');
    }
}

async function getComments(prNumber) {
    const commentsRsp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber
    });
    return commentsRsp.data;
}

async function getLastReadyForReviewTimestamp(prNumber) {
    const comments = await getComments(prNumber);
    timestamps = [];
    for (const comment of comments) {
        if (comment.body.toLowerCase().includes('ready for review')) {
            timestamps.push(Date.parse(comment.updated_at));
            if (verbose) {
                console.log(` - Ready for review found at ${comment.updated_at}`)
            }
        } else if (verbose) {
            console.log(` - Ignoring comment with id ${comment.id}`);
        }
    }
    if (timestamps.length > 0) {
        return timestamps[timestamps.length - 1];
    }
    return null;
}

async function doGetPr(prNumber) {
    const prRsp = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    });
    return prRsp.data;
}

function hasMergeState(pr) {
    return pr.mergeable_state.toLowerCase() != 'unknown';
}

async function getStabilizedPr(prNumber) {
    let attempt = 0;
    while (attempt < MAX_POLL_ATTEMPTS) {
        pr = await doGetPr(prNumber)
        if (hasMergeState(pr)) {
            return pr;
        }
        await delay(POLL_BACKOFF_MS);
    }
    return undefined;
}

function hasLabel(issue, label) {
    for (let l of issue.labels) {
        if (l.name.toLowerCase() == label.toLowerCase()) {
            return true;
        }
    }
    return false;
}

function isDraft(pull_request) {
    return pull_request.draft;
}

async function addLabel(prNumber, label) {
    console.log(`addLabel:: prNumber=${prNumber} label=${label}`);
    expectSuccess(await octokit.rest.issues.addLabels({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        labels: [label]
    }));
}

async function removeLabel(prNumber, label) {
    console.log(`removeLabel:: prNumber=${prNumber} label=${label}`);
    expectSuccess(await octokit.rest.issues.removeLabel({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        name: label
    }));
}

async function ensureLabel(issue, label, expected = true) {
    if (hasLabel(issue, label) == expected) {
        console.log('ensureLabel::hasLabel: true');
        return;
    }
    if (expected) {
        console.log('ensureLabel::adding label');
        await addLabel(issue.number, label);
    } else {
        console.log('ensureLabel::removing label');
        await removeLabel(issue.number, label);
    }
}

function getCurrentIssueLabelStatus(issue) {
    readyForReview = hasLabel(issue, 'ready-for-review');
    unstable = hasLabel(issue, 'unstable');
    changesRequested = hasLabel(issue, 'changes-requested');
    return {
        readyForReview,
        unstable,
        changesRequested
    };
}

async function checkMergeState(prNumber) {
    const mergeState = await getMergeState(prNumber);
    if (mergeState === 'clean') {
        return undefined;
    }
    if (mergeState === 'unstable') {
        return {
            canOverride: true,
            reason: 'The PR has failing checks'
        };
    }
    if (mergeState === 'draft') {
        return {
            canOverride: false,
            reason: 'The PR is still in a draft state'
        };
    }
    return {
        canOverride: false,
        reason: `The PR is not mergeable for some reason (${mergeState})`
    };
}

function getRequestedReviewers(pr) {
    return pr.requested_reviewers.map(user => user.login);
}

async function getReviews(prNumber) {
    const commentsRsp = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    });
    return commentsRsp.data;
}

function isApprove(review) {
    return review.state.toLowerCase() === 'approved';
}

function isIndicative(review) {
    return review.state.toLowerCase() !== 'commented';
}

async function getReviewersToLatestState(prNumber) {
    reviews = await getReviews(prNumber);
    reviewersToLatestState = {}
    for (let review of reviews) {
        if (isIndicative(review)) {
            user = review.user.login;
            reviewersToLatestState[user] = isApprove(review);
        }
    }
    return reviewersToLatestState;
}

async function determineIfChangesRequested(pr) {
    requestedReviewers = getRequestedReviewers(pr);
    if (verbose) {
        console.log(`Ignoring PRs from requested reviewers: ${requestedReviewers}`);
    }
    reviewersToLatestState = await getReviewersToLatestState(pr.number);
    let changesRequested = false;
    for (let reviewer of Object.keys(reviewersToLatestState)) {
        if (requestedReviewers.indexOf(reviewer) >= 0) {
            if (!reviewersToLatestState[reviewer]) {
                if (verbose) {
                    console.log(`The reviewer ${reviewer} is not ignored and has requested changes`);
                }
                changesRequested = true;
            } else if (verbose) {
                console.log(`The reviewer ${reviewer} approves`);
            }
        }
    }
    return changesRequested;
}

async function determineIfUnstable(pr) {
    if (pr.mergeable_state.toLowerCase() === 'unstable') {
        return true;
    } else if (pr.mergeable) {
        return false;
    } else {
        return undefined;
    }
}

async function getCommits(prNumber) {
    const commitsRsp = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/commits', {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    });
    return commitsRsp.data;
}

async function getLastCommitTimestamp(prNumber) {
    const commits = await getCommits(prNumber);
    const lastCommit = commits[commits.length - 1];
    return Date.parse(lastCommit.commit.committer.date);
}

async function determineIfWhitelisted(prNumber) {
    lastReadyForReview = await getLastReadyForReviewTimestamp(prNumber);
    if (lastReadyForReview) {
        lastCommitTimestamp = await getLastCommitTimestamp(prNumber);
        return lastReadyForReview > lastCommitTimestamp;
    }
    return false;
}

async function updatePrStatus(prNumber) {
    pr = await getStabilizedPr(prNumber);
    if (!pr) {
        return 'Could not determine PR status (pr.mergeable_state remained unknown)';
    }
    currentStatus = getCurrentIssueLabelStatus(pr);

    changesRequested = await determineIfChangesRequested(pr);
    unstable = await determineIfUnstable(pr);
    whitelisted = await determineIfWhitelisted(pr.number);

    console.log(`The PR ${prNumber}: changesRequested=${changesRequested} unstable=${unstable} whitelisted=${whitelisted}`);
}

function isPrIssue(issue) {
    return 'pull_request' in issue;
}

async function getOpenPrs() {
    const prsRsp = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner: repo.owner,
        repo: repo.repo,
        state: 'open'
    });
    return prsRsp.data;
}

module.exports = {
    configure: (repo_, token, verbose_) => {
        repo = repo_;
        verbose = verbose_;
        octokit = github.getOctokit(token);
    },
    getOpenPrs,
    updatePrStatus,
    isDraft,
    ensureLabel,
    hasLabel
};