const core = require('@actions/core');
const github = require('@actions/github');

async function findReadyForReviewComments(repo, prNumber) {

    const comments = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber
    });
    for (const comment of comments) {
        console.log(JSON.stringify(comment, null, 2));
    }
}

async function run() {
    try {
        const myToken = core.getInput('token');
        const octokit = github.getOctokit(myToken);
        const payload = JSON.stringify(github.context.payload, undefined, 2)
      
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

