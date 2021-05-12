# pr-needs-review action

This action adds the "needs-review" label to a PR that is not in draft state, is passing all checks, and has no requested changes.

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
