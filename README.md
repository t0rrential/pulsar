# Pulsar ad platform

A React ad package, a publisher showcase, and a SAM serverless API backed by DynamoDB. Original SVG creatives and the website live in private S3; a Lambda serves them through API Gateway HTTPS. This account requires AWS verification before creating CloudFront resources, so the showcase does not depend on CloudFront.

**Live showcase:** https://uhroesgpkb.execute-api.us-east-1.amazonaws.com/ — the previously deployed Phase 1 version. The newer tracking, administration, and raw analytics changes in this repository have not been deployed or verified in AWS.

## Run locally

Requires Node.js 24 LTS, npm, and a running Docker daemon. No AWS credentials are needed for the local demo.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens at `http://localhost:3001`, DynamoDB Local at `127.0.0.1:8000`, and S3Mock at `127.0.0.1:9000`. Set `API_PORT`, `DB_PORT`, or `STORAGE_PORT` to change these; set `VITE_API_URL` to the API URL if changing `API_PORT`. Vite prints its actual port if 5173 is occupied.

The runner starts disposable Docker containers for DynamoDB Local and S3Mock, creates the table and bucket, and seeds campaigns. Stopping it deletes local data. The local admin key defaults to `local-admin`; override it with `ADMIN_KEY`. This key and the object store are for local development only. Original SVG creatives are served by Vite. Remove a cloud `demo/.env` override before using this local-only option.

1. Open the Publisher view. There are two `sidebar` slots and one `banner` slot.
2. Open Campaign stats, select **Find your next adventure (`c3`)**, and note its click total.
3. Return to Publisher and click the banner; it opens an advertiser page in a new tab.
4. Return to Campaign stats and use Refresh stats. The `c3` click total increases after the event is recorded.
5. Use Load new ads to select new creatives. Sidebar campaigns are weighted; the banner always belongs to `c3`.

All counters are real recorded activity. The seed script only writes campaign and creative definitions, preserves existing counters, and does not fabricate historical traffic. Empty dates therefore remain zero.

The dashboard shows filled requests, rendered impressions, viewable impressions, clicks, and CTR. CTR is total clicks divided by rendered impressions. Viewable means at least half the ad remained visible for one continuous second while the document was visible.

Events are batched, deduplicated for approximately two days, and counted by UTC day. A genuine page reload or slot remount counts a new request and impression; React StrictMode's effect replay does not. The in-memory queue and beacons do not guarantee delivery when a page closes.

## Workspace

- `backend/template.yaml`: API, admin and static-site Lambdas, DynamoDB, private S3, Firehose, Glue, Athena, budget notifications and a shutdown Lambda.
- `backend/src/handlers`: ad serving, events, stats, administration, static assets and the SNS-triggered cost guard.
- `packages/react-ads`: exportable ESM/CJS React package with TypeScript declarations.
- `demo`: Vite publisher and campaign statistics views, including original SVG creatives.
- `scripts/seed.ts`: repeatable campaign/creative seed; preserves existing counters.
- `scripts/local.ts`: local database and HTTP adapter for the Lambda handlers.
- `scripts/deploy-showcase.ts` and `scripts/delete-showcase.ts`: explicit-profile deployment and confirmed teardown.
- `backend/analytics.sql`: Athena queries over buffered raw events.

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

See [the package README](packages/react-ads/README.md) for props, viewability, batching, conversion events, and delivery limitations.

Build and create an installable package tarball:

```sh
npm run build --workspace=@pulsar/react-ads
npm pack --workspace=@pulsar/react-ads
```

## Checks

```sh
npm run typecheck
npm test --workspace=@pulsar/react-ads
TABLE_NAME=test node --import tsx --test backend/src/handlers/*.test.ts
npm run build
sam validate --lint --template-file backend/template.yaml --region us-east-1
npm run build:backend -- --region us-east-1
```

`build` creates the React package and static demo (`demo/dist`); `build:backend` creates `.aws-sam/build` using SAM and esbuild.

## Administration and raw analytics

Open **Admin**, enter the admin key, and connect to list, create, edit, pause, or resume campaigns. Select a campaign to upload a PNG, JPEG, WebP, or GIF and add a creative. Uploads use five-minute presigned PUT URLs. File type is checked by declared MIME type, not by inspecting bytes or enforcing a size limit; this is a solo-operator demo, not a hardened upload service.

On AWS, events are sent to Firehose after the DynamoDB transaction and converted to Parquet in S3. Athena queries in `backend/analytics.sql` use projected UTC arrival-date partitions. Delivery is buffered for up to 15 minutes under normal conditions and may be delayed or duplicated; DynamoDB remains the live counter source. Provider-generated session IDs last for the provider instance and API URL. Events without a session ID are excluded from the session query.

## Deploy the full showcase to AWS

Requires Node.js 24 LTS, npm, AWS CLI v2, AWS SAM CLI, authenticated **non-root** credentials, and permissions for the added Firehose, Glue, Athena, S3 and IAM resources. The existing permissions boundary must permit the new roles and actions. Review the template and costs before deploying; the script executes its change set without an interactive review and the additional resources are not covered by a hard spending cap.

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
# Enter secrets locally without storing them in shell history:
read -r BUDGET_EMAIL
read -rs ADMIN_KEY; echo
export BUDGET_EMAIL ADMIN_KEY
npm run showcase:deploy
unset BUDGET_EMAIL ADMIN_KEY
```

The deployment script defaults to profile `pulsar`, region `us-east-1`, and stack **`pulsar-showcase`**. It rejects root and requires a valid account identity. `PERMISSIONS_BOUNDARY_ARN` may override the default `arn:aws:iam::<account-id>:policy/pulsar-showcase-runtime-boundary`; that policy must already exist. Each AWS/SAM command explicitly selects the profile and region.

Deployment builds and typechecks, validates the template, builds the Lambda artifacts, and deploys with `CAPABILITY_IAM`, the approved email, the permissions boundary, and tag `Project=pulsar-showcase`. It creates or verifies ownership of **`pulsar-showcase-artifacts-<account-id>-<region>`**, refusing to treat access-denied errors as a missing bucket. This artifact bucket intentionally lives outside the stack.

It then builds the demo, seeds the AWS table, and syncs the site. Existing `uploads/` objects and counters are preserved. The `AdminKey` CloudFormation parameter is masked in CloudFormation, but the deployment script passes it as a SAM process argument: other users on the machine may be able to inspect it during deployment. Use a trusted workstation and rotate the key if exposed.

The outputs include `ApiUrl`, `TableName`, `SiteBucketName`, `SiteUrl`, `BudgetName`, and `CostGuardFunctionName`:

```sh
aws cloudformation describe-stacks --stack-name pulsar-showcase \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" --query 'Stacks[0].Outputs'
```

Open SiteUrl and follow the banner-click flow to check AWS counters. CORS is not authentication. Admin access uses a shared key and the public event API remains unauthenticated; there is no fraud protection or guaranteed delivery. Do not use these counters for billing or expose this as a production ad service.

## Budget and best-effort shutdown

**AWS cannot guarantee a $5 hard cap.** The account-wide monthly budget is **US$5 gross spend**, excluding credits and refunds; other workloads in the account count too. Actual-spend thresholds at **80% ($4)** and **100% ($5)** send email and publish to SNS. The cost guard checks the expected SNS topic and sets ad API, admin and website Lambda reserved concurrency to zero.

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
aws lambda delete-function-concurrency --function-name pulsar-showcase-admin --profile "$AWS_PROFILE" --region "$AWS_REGION"
```


## Tear down

Stop local processes with Ctrl-C; Docker containers and local data are removed. For the AWS showcase, this command **permanently deletes campaign counters, uploaded creatives, raw events, query results and site assets**:

```sh
AWS_PROFILE=pulsar AWS_REGION=us-east-1 npm run showcase:delete -- --confirm
```

The script rejects root, checks account ownership, empties the stack's site, raw-events and query-results buckets when present, deletes `pulsar-showcase`, and waits for deletion. Without `--confirm`, it refuses to delete anything. Teardown of the updated stack has not been exercised.

The separately created artifact bucket and operator/deployer IAM identities are **intentionally retained**; teardown never deletes IAM access. Review billing and any remaining resources after deletion. If no stack or workflow still needs the artifact bucket, you may explicitly remove its objects and then the bucket (check the account and region first):

```sh
ACCOUNT_ID="$(aws sts get-caller-identity --profile pulsar --region us-east-1 --query Account --output text)"
ARTIFACT_BUCKET="pulsar-showcase-artifacts-${ACCOUNT_ID}-us-east-1"
aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
# Destructive and optional; run only after reviewing the bucket's contents.
aws s3 rm "s3://$ARTIFACT_BUCKET/" --recursive --profile pulsar --region us-east-1
aws s3api delete-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
```
