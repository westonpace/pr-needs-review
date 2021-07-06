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
    return rsp;
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

function isApprove(review) {
    return review.state.toLowerCase() === 'approved';
}

function isIndicative(review) {
    return review.state.toLowerCase() !== 'commented';
}

async function getApprovalStatusByAuthor(prNumber) {
    const reviews = expectSuccess(await octokit.rest.pulls.listReviews({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    })).data;
    const approvedByAuthor = {};
    for (const review of reviews) {
        if (isIndicative(review)) {
            approvedByAuthor[review.user.login] = isApprove(review);
        }
    }
    const pendingReviews = expectSuccess(await octokit.rest.pulls.listRequestedReviewers({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    })).data;
    for (const user of pendingReviews.users) {
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

module.exports = {
    configure: (repo_, token, verbose_) => {
        repo = repo_;
        verbose = verbose_;
        octokit = github.getOctokit(token);
    },
    isDraft,
    ensureLabel,
    hasLabel,
    getApprovalStatusByAuthor
};