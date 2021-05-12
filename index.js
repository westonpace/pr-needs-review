const core = require('@actions/core');
const github = require('@actions/github');

try {
  const myToken = core.getInput('token');
  const octokit = github.getOctokit(myToken);
  const payload = JSON.stringify(github.context.payload, undefined, 2)
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}