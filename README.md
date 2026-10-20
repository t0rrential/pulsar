# Pulsar ad platform

A React ad package, a publisher showcase, and a SAM serverless API backed by DynamoDB. Original SVG creatives and the website live in private S3; a Lambda serves them through API Gateway HTTPS. This account requires AWS verification before creating CloudFront resources, so the showcase does not depend on CloudFront.

**Live showcase:** https://uhroesgpkb.execute-api.us-east-1.amazonaws.com/ — deployed to AWS in `us-east-1`. Verified in the browser: three ad images load over HTTPS, an advertiser link opens, and the `c3` click counter increases in AWS DynamoDB-backed statistics. The deployed shutdown handler was invoked: all four serving functions reached zero concurrency and the site returned HTTP 503; normal concurrency was then restored and the site returned HTTP 200. Budget notification delivery at a real spend threshold has not been triggered.

## Run locally

Requires Node.js 24 LTS and npm. No AWS credentials or Docker required for the local demo.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens at `http://localhost:3001` and the local database at `127.0.0.1:8000`. `API_PORT` and `DB_PORT` can change the API/database ports; update `demo/.env` if you change the API port. Vite prints its actual port if 5173 is already occupied.

The local runner creates and seeds an **in-memory DynamoDB-compatible database (Dynalite)** and invokes the same handlers used by Lambda. It never uses an AWS table or creates cloud resources. Stopping it resets campaigns and counters. Original SVG creatives in `demo/public/creatives` are served locally; no external image service is needed. Remove a cloud `demo/.env` override before using this cloud-free option.

1. Open the Publisher view. There are two `sidebar` slots and one `banner` slot.
2. Open Campaign stats, select **Find your next adventure (`c3`)**, and note its click total.
3. Return to Publisher and click the banner; it opens an advertiser page in a new tab.
4. Return to Campaign stats and use Refresh stats. The `c3` click total increases after the event is recorded.
5. Use Load new ads to select new creatives. Sidebar campaigns are weighted; the banner always belongs to `c3`.

All counters are real recorded activity. The seed script only writes campaign and creative definitions, preserves existing counters, and does not fabricate historical traffic. Empty dates therefore remain zero.

The campaign dashboard focuses on one selected campaign at a time. Four metric cards show period totals for filled ad requests, rendered impressions, clicks, and click-through rate. CTR uses total clicks divided by total impressions, not an average of daily rates; it displays `—` when there are no impressions. The daily activity chart compares impressions and clicks, and **Daily breakdown** expands the exact UTC data. Campaign switching and Refresh stats fetch real API data; charts do not generate sample history.

Requests count filled ad responses; impressions count rendered ads, not viewability. Dates are UTC. A genuine page reload or slot remount counts a new request and impression; React StrictMode's effect replay does not.

## Workspace

- `backend/template.yaml`: HTTP API, three ad/analytics Lambdas, a static-site Lambda, DynamoDB, private S3, scoped IAM, budget notifications and a shutdown Lambda.
- `backend/src/handlers`: `GET /ad`, `POST /events`, `GET /stats`, static assets and the SNS-triggered cost guard.
- `packages/react-ads`: exportable ESM/CJS React package with TypeScript declarations.
- `demo`: Vite publisher and campaign statistics views, including original SVG creatives.
- `scripts/seed.ts`: repeatable campaign/creative seed; preserves existing counters.
- `scripts/local.ts`: local database and HTTP adapter for the Lambda handlers.
- `scripts/deploy-showcase.ts` and `scripts/delete-showcase.ts`: explicit-profile deployment and confirmed teardown.

## React package

The package is available as `@pulsar/react-ads` inside this workspace; it has not been published to npm.

```tsx
import { AdProvider, AdSlot, AdStats } from '@pulsar/react-ads';

export function Publisher({ apiUrl }: { apiUrl: string }) {
  return (
    <AdProvider apiUrl={apiUrl}>
      <AdSlot placement="sidebar" />
      <AdStats campaignId="c1" days={7} />
    </AdProvider>
  );
}
```

`AdProvider` requires `apiUrl` and children. `AdSlot` requires `placement`. `AdStats` requires `campaignId`; `days` defaults to 7. Change its optional `refreshKey` (string or number) to refetch statistics. React and React DOM 18 or 19 are peer dependencies.

The provider sends plain-string beacons; if unavailable or refused, it uses `fetch` with `keepalive`. Loading and network failure states are visible; no-fill renders nothing.

Build and create an installable package tarball:

```sh
npm run build --workspace=@pulsar/react-ads
npm pack --workspace=@pulsar/react-ads
```

## Checks

```sh
npm run typecheck
npm test --workspace=@pulsar/react-ads
npm run build
sam validate --lint --template-file backend/template.yaml --region us-east-1
npm run build:backend -- --region us-east-1
```

`build` creates the React package and static demo (`demo/dist`). `build:backend` separately creates `.aws-sam/build` using SAM and esbuild; Docker is not needed. The package lifecycle tests cover StrictMode, no-fill, stale responses, remounting, beacon fallback, and stats refresh.

## Deploy the full showcase to AWS

Requires Node.js 24 LTS, npm dependencies (`npm install`), AWS CLI v2, AWS SAM CLI, and authenticated **non-root** credentials. The operator needs the stack's service permissions plus artifact-bucket, SNS, Budgets and IAM execution-role permissions. No Docker, paid WAF, custom domain, public S3 website or CloudFront account verification is required.

The local profile **`pulsar`** uses temporary credentials through a local `credential_process` (initial session expires 2026-10-19 17:08 UTC), not credentials committed to this repository. It uses the non-root operator `pulsar-operator` / deployer role `PulsarShowcaseDeployer`; bootstrap access keys have been deleted. The default CLI profile now forwards to `pulsar`, and the cached root CLI login was removed. CLI and MCP identities were verified as the non-root deployment role. Expired sessions must be renewed using the non-root authentication flow below; expiration does not stop the deployed website.

The operator's first console sign-in is **https://061039759623.signin.aws.amazon.com/console**, IAM username `pulsar-operator`. The initial password is in macOS Keychain, service `pulsar-aws-console`, account `pulsar-operator`; password reset is required at first sign-in. Retrieve it privately with Keychain Access, or on the authorized workstation:

```sh
security find-generic-password -s pulsar-aws-console -a pulsar-operator -w
```

Do not paste its output, temporary credentials, or the alert recipient into source control or shared logs.

To renew after the initial temporary session expires, first sign in as `pulsar-operator` in the console and reset its initial password. Then authenticate the CLI and configure the role profile:

```sh
aws login --profile pulsar-operator
aws configure set role_arn arn:aws:iam::061039759623:role/PulsarShowcaseDeployer --profile pulsar
aws configure set source_profile pulsar-operator --profile pulsar
aws configure set credential_process '' --profile pulsar
aws sts get-caller-identity --profile pulsar
```

The last command must show `assumed-role/PulsarShowcaseDeployer`, not `:root`. Register MFA for the operator in the AWS console before routine use.

```sh
export AWS_PROFILE=pulsar
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION="$AWS_REGION"
aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
# Enter the approved recipient locally without storing it in shell history:
read -r BUDGET_EMAIL
export BUDGET_EMAIL
npm run showcase:deploy
unset BUDGET_EMAIL
```

The deployment script defaults to profile `pulsar`, region `us-east-1`, and stack **`pulsar-showcase`**. It rejects root and requires a valid account identity. `PERMISSIONS_BOUNDARY_ARN` may override the default `arn:aws:iam::<account-id>:policy/pulsar-showcase-runtime-boundary`; that policy must already exist. Each AWS/SAM command explicitly selects the profile and region.

Deployment builds and typechecks, validates the template, builds the Lambda artifacts, and deploys with `CAPABILITY_IAM`, the approved email, the permissions boundary, and tag `Project=pulsar-showcase`. It creates or verifies ownership of **`pulsar-showcase-artifacts-<account-id>-<region>`**, refusing to treat access-denied errors as a missing bucket. This artifact bucket intentionally lives outside the stack.

It then reads the exact stack outputs, builds the demo with `VITE_API_URL`, seeds the AWS table with `<SiteUrl>/creatives` (without a local DynamoDB endpoint), and syncs `demo/dist` to the private site bucket. HTML uses a short 60-second cache lifetime, fingerprinted assets are immutable for one year, and SVGs cache for one hour. Browser caches honor these headers; there is no CDN or invalidation step. Re-deployment preserves real counters and refuses to proceed if it detects zero-concurrency API or website functions; it does not automatically recover a stopped showcase.

The outputs include `ApiUrl`, `TableName`, `SiteBucketName`, `SiteUrl`, `BudgetName`, and `CostGuardFunctionName`:

```sh
aws cloudformation describe-stacks --stack-name pulsar-showcase \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" --query 'Stacks[0].Outputs'
```

Open SiteUrl and follow the `c3` banner-click flow above to check actual AWS counters. Website and API share an HTTPS origin; cross-origin CORS permits only the local demo origin. The API is intentionally unauthenticated: CORS is not authentication or abuse protection. There is no event deduplication, viewability measurement, fraud protection, or delivery guarantee. Do not use these counters for billing or expose this as a production ad service.

## Budget and best-effort shutdown

**AWS cannot guarantee a $5 hard cap.** The account-wide monthly budget is **US$5 gross spend**, excluding credits and refunds; other workloads in the account count too. Actual-spend thresholds at **80% ($4)** and **100% ($5)** send email and publish to SNS. The cost guard checks the expected SNS topic and sets all three API Lambdas and the website Lambda's reserved concurrency to zero.

Billing data, budget evaluation and SNS delivery are delayed. Requests may incur costs before shutdown; DynamoDB/S3 storage, API Gateway and other charges can continue afterward. This is a best-effort reduction in exposure, not a guaranteed ceiling. The stack also uses seven-day log retention, API throttling at 5 requests/second with burst 20, and no paid WAF/custom domain. Monitor billing yourself and delete the stack when it is not needed.

### Manual recovery after shutdown

**First review current account spend, the reason for shutdown, and remaining monthly exposure. Only recover if you deliberately accept further charges.** Check Budgets, billing and the cost-guard Lambda logs. A new notification may stop the showcase again. Re-deploying is not the recovery procedure, and removing concurrency limits restores the API's normal ability to scale.

Using the non-root profile, restore the API and website functions:

```sh
export AWS_PROFILE=pulsar AWS_REGION=us-east-1
aws lambda delete-function-concurrency --function-name pulsar-showcase-get-ad --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws lambda delete-function-concurrency --function-name pulsar-showcase-post-events --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws lambda delete-function-concurrency --function-name pulsar-showcase-get-stats --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws lambda delete-function-concurrency --function-name pulsar-showcase-site --profile "$AWS_PROFILE" --region "$AWS_REGION"
```


## Tear down

Stop local processes with Ctrl-C; the local-only demo has no AWS resources to remove. For the AWS showcase, this command **permanently deletes campaign counters, campaign data and site assets**:

```sh
AWS_PROFILE=pulsar AWS_REGION=us-east-1 npm run showcase:delete -- --confirm
```

The script rejects root, reads the stack's exact `SiteBucketName`, checks account ownership, empties only that bucket, deletes `pulsar-showcase`, and waits for deletion. Without `--confirm`, it refuses to delete anything. Teardown has not been exercised against the live showcase.

The separately created artifact bucket and operator/deployer IAM identities are **intentionally retained**; teardown never deletes IAM access. Review billing and any remaining resources after deletion. If no stack or workflow still needs the artifact bucket, you may explicitly remove its objects and then the bucket (check the account and region first):

```sh
ACCOUNT_ID="$(aws sts get-caller-identity --profile pulsar --region us-east-1 --query Account --output text)"
ARTIFACT_BUCKET="pulsar-showcase-artifacts-${ACCOUNT_ID}-us-east-1"
aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
# Destructive and optional; run only after reviewing the bucket's contents.
aws s3 rm "s3://$ARTIFACT_BUCKET/" --recursive --profile pulsar --region us-east-1
aws s3api delete-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
```
