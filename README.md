# pr-needs-review action

This action adds a number of labels to PRs in order to help maintainers of busy repositories know which PRs are in progress and which need reviews.

## Labels

### `changes-requested`

This label will be applied if a reviewer has submitted a PR review with the "request changes" feedback. This label can be cleared by the submitter by requesting a re-review from the reviewer. The label can be cleared by the reviewer by submitting a newer PR review with "Approve" feedback.

### `unstable`

This label will be applied if a PR has failing checks. This label can be cleared by updating the PR or rerunning workflows until all checks are passing. In addition, the user can submit a comment that includes (case insensitive) the phrase "ready for review". For example, "The Java failure is unrelated. This PR is ready for review". Any "ready for review" comment will be invalidated as soon as a commit has been pushed that is newer than the comment.

### `unmergeable`

This label will be applied if a PR cannot be merged. Typically this is because the PR is out of date with the origin branch.

### `needs-review`

This label will be applied if none of the above labels apply.

## Inputs

### `who-to-greet`

**Required** The name of the person to greet. Default `"World"`.

## Outputs

### `time`

The time we greeted you.

## Example usage

uses: actions/hello-world-javascript-action@v1.1
with:
who-to-greet: 'Mona the Octocat'
