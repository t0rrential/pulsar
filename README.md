# Pulsar ad platform

A React ad package, a publisher showcase, and a SAM serverless API backed by DynamoDB. Original SVG creatives and the website live in private S3; a Lambda serves them through API Gateway HTTPS. This account requires AWS verification before creating CloudFront resources, so the showcase does not depend on CloudFront.

**Existing live showcase:** https://uhroesgpkb.execute-api.us-east-1.amazonaws.com/ — this is an older, separately deployed snapshot. The current repository's account authentication and AWS configuration have not been deployed or live-verified there.

## Run locally

Requires Node.js 24 LTS, npm, and a running Docker daemon. No AWS credentials are needed for the local demo. Account emails require a real SMTP service with TLS/STARTTLS:

```sh
npm install
read -rs SMTP_URL; echo
export SMTP_URL
export SMTP_FROM='noreply@example.com'
npm run dev
```

Set `SMTP_URL` to the SMTP connection URL supplied by your mail provider, including credentials when required, and `SMTP_FROM` to an authorized sender address. The prompt avoids placing the URL in shell history. Treat it as a secret. Without both settings, account email cannot be sent; there is no MFA bypass.

Open **http://127.0.0.1:5173**. The API listens at `http://localhost:3001`, DynamoDB Local at `127.0.0.1:8000`, and S3Mock at `127.0.0.1:9000`. Set `API_PORT`, `DB_PORT`, or `STORAGE_PORT` to change these; set `VITE_API_URL` to the API URL if changing `API_PORT`. If Vite uses another port, set `LOCAL_WEB_ORIGIN` to its exact origin and `CREATIVE_BASE_URL` to that origin followed by `/creatives`.

The runner starts disposable Docker containers for DynamoDB Local and S3Mock, creates the table and bucket, and seeds six campaigns, eight creatives, and seven days of synthetic sample statistics. Four campaigns start active and two paused. The dashboard labels local data as sample data; subsequent interactions add real events to those local counters. Stopping the runner deletes all local data, including accounts and group memberships. The local group enrollment key defaults to `local-admin`; override it with `ADMIN_KEY`. This key and the object store are for local development only. Original SVG creatives are served by Vite. Remove a cloud `demo/.env` override before using this local-only option.

1. Open **Overview**, select **Find your next adventure (`c3`)**, and note its click total.
2. Open **Publisher preview**. Use the desktop or mobile width controls to inspect one `sidebar` and one `banner` slot.
3. Click the banner; it opens an advertiser page in a new tab.
4. Return to **Overview** and use **Refresh data** after the event is recorded. The `c3` click total increases.
5. Use **Refresh ads** in Publisher preview to select new creatives. Sidebar campaigns are weighted; the banner always belongs to `c3` in the default seed.

Synthetic history is written only to the disposable local database. The normal seed script writes campaign and creative definitions, preserves existing counters, and does not fabricate AWS traffic; cloud counters reflect recorded activity. **Reseeding overwrites the six fixed campaign definitions and their seeded creatives**, including edits made through Campaigns. Other campaigns, uploaded objects, and existing counters are not reset.

The shadcn/ui dashboard shows filled requests, rendered impressions, viewable impressions, clicks, conversions and CTR. CTR is total clicks divided by rendered impressions. Viewable means at least half the ad remained visible for one continuous second while the document was visible. Metrics absent from an older API response are shown as unavailable rather than zero.

Use the theme selector in the header to follow the system appearance or choose light or dark. The preference is saved in the browser.

Events are batched and counted by UTC day. Event IDs are deduplicated for approximately two days, or 30 days for fingerprinted events. A genuine page reload or slot remount counts a new request and impression; React StrictMode's effect replay does not. The in-memory queue and beacons do not guarantee delivery when a page closes.

Browser fingerprinting is optional and off until the visitor opts in. It hashes browser characteristics together with the publisher's origin, so the same signals on different sites produce different identifiers. A fingerprint is pseudonymous, not anonymous: different browsers may collide and browser changes may change the identifier. It is not suitable as proof of identity.

The browser hashes the page origin, user agent, language, platform, hardware concurrency, screen dimensions and color depth, and time zone locally using SHA-256. With consent it sends the resulting 64-character hexadecimal digest and coarse browser family and device category alongside ordinary event fields; it does not send the underlying fingerprint inputs or raw user agent. The origin is not a secret, and hashing does not make the identifier anonymous. Publishers integrating the package must obtain and manage appropriate consent themselves; the showcase's checkbox applies only to its own site.

Fingerprint associations are stored separately in DynamoDB under `PK = FINGERPRINT#<fingerprint>` and `SK = EVENT#<eventId>`, with `expiresAt` set 30 days after ingestion. After connecting under **Campaigns**, select a campaign and scroll to **Browser fingerprints** for approximate distinct fingerprints, daily events, first observed versus previously seen within retained history, and the latest hashes with coarse browser/device labels. Older associations have unknown labels. The 30-day view has no earlier comparison window, so returning is zero. The report ignores expired rows and scans at most 10,000 table items; it fails rather than presenting partial counts when this limit is exceeded, and displays at most 200 fingerprints. DynamoDB TTL deletion is asynchronous and can occur after expiry. Withdrawing consent stops future collection but does not immediately delete existing associations or recall events already sent. Fingerprints, browser/device labels and raw input signals are not sent to Firehose or stored in S3 analytics history.

### Try fingerprint reporting

1. In **Publisher preview**, enable **Allow fingerprinting on this site** only if you consent to the collection described above. Copy the displayed digest if you want to find your own row.
2. Select **Refresh ads** and allow a few seconds for the event batch to be sent. A filled ad generates real activity; no-fill responses do not create an impression.
3. Open **Campaigns**, sign in and join with the deployment key if needed, select the campaign that served the ad, and scroll to **Browser fingerprints**. For the default seeded banner, select **Find your next adventure** (`c3`). Use **Refresh** if its event is not yet visible.
4. The table displays the digest, coarse browser and device, last-seen time and event count. Select **Last 7 days** or **Last 30 days**; the report only covers activity within its retained history.
5. Turn the consent checkbox off when finished. This prevents future fingerprint collection but does not erase existing records.

The local demo uses `local-admin`; keep any deployment key private and do not show it during a recording. The older live snapshot is not a verification of the current authentication flow. Its report reflects shared activity, not the local synthetic history.

## Workspace

- `backend/template.yaml`: API, admin and static-site Lambdas, DynamoDB, private S3, Firehose, Glue, Athena, budget notifications and a shutdown Lambda.
- `backend/src/handlers`: ad serving, events, stats, administration, static assets and the SNS-triggered cost guard.
- `packages/react-ads`: exportable ESM/CJS React package with TypeScript declarations.
- `demo`: Vite publisher, campaign dashboard, and administration views, using Tailwind and shadcn/ui components.
- `scripts/seed.ts`: repeatable campaign/creative seed; preserves existing counters.
- `scripts/local.ts`: local database and HTTP adapter for the Lambda handlers.
- `scripts/deploy-showcase.ts` and `scripts/delete-showcase.ts`: explicit-profile deployment and confirmation-gated teardown; updated-stack teardown has not been exercised on AWS.
- `backend/analytics.sql`: Athena queries over buffered raw events.

The optional `presentation/` directory is ignored by Git. When present locally, `demo-script.md` is the live walkthrough, `current-script.md` is the matching slide narration, and `pulsar-current.pdf` / `pulsar-current.pptx` are the current deck. The `pulsar-midpoint` slides and older graphs are historical snapshots. Presentation files are not included in a clone unless distributed separately.

The current speaking scripts are also available together as `presentation/pulsar-current-scripts.pdf`; `presentation/pulsar-current-pack.zip` bundles the deck, scripts, and standalone architecture diagram. To refresh the materials when their sources change:

1. Render `presentation/pulsar-architecture.dot` to `pulsar-architecture.svg` and `.png` with Graphviz.
2. Run `python3 presentation/generate-current.py` for the HTML slides and editable PowerPoint, `python3 presentation/generate-poster.py` for the poster, and `python3 presentation/generate-scripts.py` for the combined scripts HTML. The deck and poster generators require `python-pptx`, Pillow, and matplotlib.
3. Print `current-slides.html` and `current-scripts.html` to their matching PDFs with backgrounds enabled; refresh the poster preview and presentation ZIP when distributing them.

The charts use `presentation/synthetic-snapshot.json`, a labeled synthetic campaign snapshot; they are not real visitor data.

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

See [the package README](packages/react-ads/README.md) for props, fingerprint consent, viewability, batching, conversion events, and delivery limitations.

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
PATH="$PWD/node_modules/.bin:$PATH" npm run build:backend -- --region us-east-1
```

`build` creates the React package and static demo (`demo/dist`); `build:backend` creates `.aws-sam/build` using SAM and esbuild.

## API

All routes are relative to `ApiUrl`. The ad, event, and stats routes are public. Administration requires an authenticated account that has joined this deployment's administrator group; a deployment key alone is not an API credential. CORS does not provide authentication.

| Route | Purpose |
| --- | --- |
| `GET /ad?placement=sidebar` | Select an active campaign and creative for a placement; returns an ad on `200` or no fill on `204`. |
| `POST /events` | Record a batch of 1–100 events, up to 64 KiB decoded JSON; returns `202` when accepted. JSON is parsed even with `text/plain` for browser beacons. |
| `GET /stats?campaignId=c1&days=7` | Return daily UTC counters; `days` defaults to 7 and must be 1–365. Missing days are zero-filled. |
| `POST /auth/register`, `POST /auth/confirm` | Create an account and confirm its email address. |
| `POST /auth/login`, `POST /auth/verify` | Sign in with a password and the emailed one-time code. |
| `GET /auth/me`, `POST /auth/join`, `POST /auth/logout` | Check membership, join with the deployment key, or revoke the session. |
| `GET /campaigns`, `POST /campaigns`, `PUT /campaigns/{id}` | List, create, and edit campaigns. |
| `POST /campaigns/{id}/creatives` | Attach a creative to an existing campaign. |
| `POST /uploads` | Create a five-minute presigned image upload URL. |
| `GET /campaigns/{id}/fingerprints?days=7` | Admin-only retained fingerprint report; `days` is 1–30. |
| `GET /analytics/pipeline` | Admin-only Firehose status and bounded S3 object metadata listing. |
| `POST /analytics/queries` | Start a predefined Athena query for at most 31 inclusive UTC arrival dates. |
| `GET /analytics/queries/{id}` | Read status and results for a query in the configured workgroup. |

Each event has an `eventId`, `type` (`impression`, `viewable`, `click`, or `conversion`), `impressionId`, `campaignId`, `creativeId`, `placement`, and millisecond timestamp `ts`. `sessionId` and a 64-character lowercase hexadecimal `fingerprint` are optional. A fingerprinted event can additionally carry `browser` (`Chrome`, `Edge`, `Firefox`, `Safari`, `Other`) and `device` (`Mobile`, `Tablet`, `Desktop`, `Other`); labels without a fingerprint are rejected. Identifier fields use 1–128 letters, digits, underscores, or hyphens. Deduplication and the counter increment happen in a DynamoDB transaction; fingerprint associations use that same transaction.

If Firehose rejects a batch, the API can return `503` after counters have already been updated. Retrying the same event IDs avoids double-counting and can retry pending raw delivery, but there is no independent replay worker. Client queues and beacon delivery are best-effort, and raw delivery can be delayed or duplicated.

## Administration and raw analytics

Open **Campaigns**, create an account, and confirm the code sent to your email address. Sign in with your password and the new emailed verification code. The first time you sign in, enter the deployment key to join its administrator group. All members share access to the deployment's campaigns and analytics; the key is not a separate group or a direct API credential. Sign in again when the session expires. Select a campaign to upload a PNG, JPEG, WebP, or GIF and add a creative. Uploads use five-minute presigned PUT URLs. File type is checked by declared MIME type, not by inspecting bytes or enforcing a size limit; this is a solo-operator demo, not a hardened upload service. The Overview campaign selector is currently a fixed list of seeded campaigns, so newly created campaigns appear in Campaigns but not automatically in Overview.

On AWS, events are sent to Firehose after the DynamoDB transaction and converted to Parquet in S3. Under **Campaigns**, connect and select **Open analytics pipeline**. **Load pipeline** shows Firehose status and up to 20 S3 object metadata entries; the listing reads at most two pages per prefix and labels an incomplete sample. Choose a predefined query and up to 31 UTC arrival dates, click **Run query**, then refresh its status to see results and bytes scanned. Queries never run automatically. Athena scans, S3 requests and stored results incur charges; the template caps each query at 100,000,000 scanned bytes, but a cancelled query can still incur charges. The local demo reports the cloud pipeline as unconfigured rather than simulating AWS.

Athena queries in `backend/analytics.sql` also use projected UTC arrival-date partitions; adjust the example dates before running them. Firehose delivery is buffered for up to 15 minutes under normal conditions and may be delayed or duplicated; DynamoDB remains the live counter source. Provider-generated session IDs last for the provider instance and API URL. Events without a session ID are excluded from the session query. In the earlier deployment, the deployer role was denied `athena:StartQueryExecution`; dashboard queries ran as the scoped admin Lambda role, not as the deployer.

## Deploy the full showcase to AWS

Requires Node.js 24 LTS, npm, AWS CLI v2, AWS SAM CLI and authenticated **non-root** AWS credentials. This procedure also works in another person's AWS account: the account owner must provide an appropriately authorized profile and approve the deployment and associated charges. Permissions must cover the template's Cognito, SES, Lambda, API Gateway, DynamoDB, Firehose, Glue, Athena, S3, CloudFormation, Budgets and IAM resources. The deployer needs permission to create Cognito's SES service-linked role if it does not already exist. Review the template and costs first; the script executes its change set without an interactive review, and budgets are not hard spending caps.

The current AWS implementation has not been deployed or live-verified. The existing live showcase is an older snapshot; historical checks against it do not verify this procedure or the current authentication flow.

In the target account and Region, verify an email address or domain in Amazon SES and use an address covered by that identity as the sender. Cognito email MFA requires the Essentials or Plus feature plan and your own SES configuration. While SES is in its sandbox, it can send only to verified recipients; request SES production access to email other users. Cognito cannot use email as both the MFA factor and the self-service password-recovery channel, so account recovery is administrator-managed.

```sh
export AWS_PROFILE=your-non-root-profile
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION="$AWS_REGION"
aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
export SES_SENDER_EMAIL='noreply@example.com'
export SES_IDENTITY_ARN='arn:aws:ses:us-east-1:123456789012:identity/example.com'
read -r BUDGET_EMAIL
read -rs ADMIN_KEY; echo
export BUDGET_EMAIL ADMIN_KEY
npm run showcase:deploy
unset BUDGET_EMAIL ADMIN_KEY
```

Replace the example profile, email and SES identity ARN with values from the **target** account. `ADMIN_KEY` must contain at least 32 letters, digits, underscores or hyphens. Share it privately only with people who should join the administrator group. The script defaults to profile `pulsar`, region `us-east-1` and stack `pulsar-showcase`. It rejects root credentials. A permissions boundary is optional by default; if the target account requires one, set `PERMISSIONS_BOUNDARY_ARN` to an existing managed policy that permits the runtime actions. Each AWS/SAM command explicitly selects the profile and Region.

Deployment builds and typechecks, validates the template, builds the Lambda artifacts, and deploys with `CAPABILITY_IAM`, the approved email, the permissions boundary, and tag `Project=pulsar-showcase`. It creates or verifies ownership of **`pulsar-showcase-artifacts-<account-id>-<region>`**, refusing to treat access-denied errors as a missing bucket. This artifact bucket intentionally lives outside the stack.

It then builds the demo, seeds the AWS table, and syncs the site. Existing `uploads/` objects and counters are preserved, but the fixed seed campaign and creative definitions are overwritten. The `AdminKey` CloudFormation parameter is masked in CloudFormation, but the deployment script passes it as a SAM process argument and failed commands can expose it in error output. Other users on the machine may be able to inspect it during deployment. Use a trusted workstation and rotate the key if exposed.

The outputs include `ApiUrl`, `TableName`, `SiteBucketName`, `SiteUrl`, `BudgetName`, and `CostGuardFunctionName`:

```sh
aws cloudformation describe-stacks --stack-name pulsar-showcase \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" --query 'Stacks[0].Outputs'
```

Open SiteUrl and follow the banner-click flow to check AWS counters. CORS is not authentication. The public event API remains unauthenticated; there is no fraud protection or guaranteed delivery. Do not use these counters for billing or expose this as a production ad service.

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
aws lambda delete-function-concurrency --function-name pulsar-showcase-auth --profile "$AWS_PROFILE" --region "$AWS_REGION"
```


## Tear down

Stop local processes with Ctrl-C; Docker containers and local data are removed. For the AWS showcase, this command **permanently deletes campaign counters, uploaded creatives, raw events, query results and site assets**:

```sh
AWS_PROFILE=pulsar AWS_REGION=us-east-1 npm run showcase:delete -- --confirm
```

The script rejects root, checks account ownership, empties the stack's site, raw-events and query-results buckets when present, deletes `pulsar-showcase`, and waits for deletion. Without `--confirm`, it refuses to delete anything. Teardown of the updated stack has not been exercised.

The Cognito user pool is retained on stack deletion or replacement, while the stack's DynamoDB table and group memberships are deleted. The separately created artifact bucket and operator/deployer IAM identities are also **intentionally retained**. Review and explicitly remove retained resources only when they are no longer needed. If no stack or workflow still needs the artifact bucket, you may explicitly remove its objects and then the bucket (check the account and region first):

```sh
ACCOUNT_ID="$(aws sts get-caller-identity --profile pulsar --region us-east-1 --query Account --output text)"
ARTIFACT_BUCKET="pulsar-showcase-artifacts-${ACCOUNT_ID}-us-east-1"
aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
# Destructive and optional; run only after reviewing the bucket's contents.
aws s3 rm "s3://$ARTIFACT_BUCKET/" --recursive --profile pulsar --region us-east-1
aws s3api delete-bucket --bucket "$ARTIFACT_BUCKET" --expected-bucket-owner "$ACCOUNT_ID" --profile pulsar --region us-east-1
```
