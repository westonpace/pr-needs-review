const core = require('@actions/core');
const github = require('@actions/github');

const verbose = 'true' === core.getInput('verbose').toLowerCase();
const myToken = core.getInput('token');
const octokit = github.getOctokit(myToken);
const payload = JSON.stringify(github.context.payload, undefined, 2)

async function getComments(repo, prNumber) {
    const commentsRsp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber
    });
    return commentsRsp.data;
}

async function lookInCommentsForPass(repo, prNumber) {
    const comments = await getComments(repo, prNumber);
    timestamps = [];
    let passing = false;
    for (const comment of comments) {
        if (comment.body.toLowerCase().includes('pass')) {
            passing = true;
        } else if (comment.body.toLowerCase().includes('fail')) {
            passing = false;
        }
    }
    return passing;
}

async function run() {
    try {
        prNumber = github.context.payload.number;
        const passing = await lookInCommentsForPass(repo, prNumber);
        if (passing) {
            console.log('Passed');
        } else {
            core.setFailed('Found no comments with "pass" or found a comment with "fail"');
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run().catch(err => {
    core.setFailed(err.message);
});

