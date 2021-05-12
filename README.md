# pr-needs-review action

This action ensures that PRs either have an "awaiting review" label or an "awaiting changes" label. For
busy repositories this can help reviewers keep track of which PRs need attention. It also communicates
clearly to contributors that action is required on their end to progress their PR.

## Labels

### `awaiting-changes`

This label will be applied if a reviewer has submitted a PR review with the "request changes" feedback. This label can be cleared by the submitter by requesting a re-review from the reviewer. The label can also be cleared if the reviewer submits a newer PR review with "Approve" feedback. Finally this label can be cleared if the reviewer posts a comment with the special string. When this label is first applied a message will be posted to the review explaining how to remove the label.

### `awaiting-review`

This label will be applied on all new PRs to signify that the PR needs review. This label will be removed if the PR
is put into draft state. This PR will also be removed if the awaiting-changes label is applied.

## Inputs

### `token`

**Required** This should be a token used to access the current repository.

### `verbose`

If set to true then the action will log extra information useful for debugging.

## Example usage

```
# You must apply this action to all of these triggers to ensure the label
# is kept up to date.
on:
  issue_comment:
  pull_request:
    types:
      - ready_for_review
      - opened
      - converted_to_draft
  pull_request_review:

jobs:
  main_job:
    runs-on: ubuntu-latest
    name: Update review status labels
    steps:
      - name: Update review status labels
        uses: westonpace/pr-needs-review@v1
        id: label-pr
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```
