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

async function run() {
    try {
        prNumber = github.context.payload.number;
      
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: prNumber,
          body: 'Hello!  This is a sample comment created by a bot'
        });

        await findReadyForReviewComments(github.context.repo, prNumber);
      
        console.log(`The event payload: ${payload}`);
      } catch (error) {
        core.setFailed(error.message);
      }
}

run().catch(err => {
    core.setFailed(err.message);
});

