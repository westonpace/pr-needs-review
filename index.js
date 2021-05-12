const core = require('@actions/core');
const github = require('@actions/github');

const MAX_POLL_ATTEMPTS = 5
const POLL_BACKOFF_MS = 30

const verbose = 'true' === core.getInput('verbose').toLowerCase();
const myToken = core.getInput('token');
const octokit = github.getOctokit(myToken);
const payload = JSON.stringify(github.context.payload, undefined, 2)

function delay(delay_ms) {
    return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

async function getComments(repo, prNumber) {
    const commentsRsp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber
    });
    return commentsRsp.data;
}

async function findReadyForReviewComments(repo, prNumber) {
    const comments = await getComments(repo, prNumber);
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
    return timestamps;
}

async function doGetMergeState(repo, prNumber) {
    const mergeStateRsp = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber
    });
    return mergeStateRsp.data.mergeable_state.toLowerCase();
}

async function getMergeState(repo, prNumber) {
    let attempt = 0;
    while (attempt < MAX_POLL_ATTEMPTS) {
        state = await doGetMergeState(repo, prNumber)
        if (state != 'unknown') {
            return state;
        }
        await delay(POLL_BACKOFF_MS);
    }
}

async function checkMergeState(repo, prNumber) {
    const mergeState = await getMergeState(repo, prNumber);
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

async function run() {
    try {
        repo = github.context.repo;
        prNumber = github.context.payload.number;

        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: prNumber,
            body: 'Hello!  This is a sample comment created by a bot'
        });

        const mergeState = await getMergeState(repo, prNumber);
        if (mergeState && !mergeState.canOverride) {

        }
        await findReadyForReviewComments(github.context.repo, prNumber);

        console.log(`The event payload: ${payload}`);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run().catch(err => {
    core.setFailed(err.message);
});

