import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const profile = process.env.AWS_PROFILE || 'pulsar';
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const stack = 'pulsar-showcase';
const env = { ...process.env, AWS_PROFILE: profile, AWS_REGION: region, AWS_DEFAULT_REGION: region, AWS_PAGER: '' };
const awsArgs = ['--profile', profile, '--region', region, '--no-cli-pager'];

type StackOutput = { OutputKey: string; OutputValue: string };
type StackDescription = { Stacks: { Outputs?: StackOutput[] }[] };

function run(command: string, args: string[], childEnv: NodeJS.ProcessEnv = env): void {
  execFileSync(command, args, { cwd, env: childEnv, stdio: 'inherit' });
}

function aws<T>(args: string[]): T {
  const output = execFileSync('aws', [...awsArgs, ...args, '--output', 'json'], { cwd, env, encoding: 'utf8' }).trim();
  return (output ? JSON.parse(output) : {}) as T;
}

function main(): void {
  const email = process.env.BUDGET_EMAIL?.trim();
  if (!email) throw new Error('Set BUDGET_EMAIL to the approved budget-alert address before deploying.');
  const identity = aws<{ Account: string; Arn: string }>(['sts', 'get-caller-identity']);
  if (!/^\d{12}$/.test(identity.Account) || !identity.Arn) throw new Error('AWS returned no valid account identity.');
  if (identity.Arn.endsWith(':root')) throw new Error('Root credentials are forbidden. Use a non-root AWS profile.');
  const account = identity.Account;
  const boundary = process.env.PERMISSIONS_BOUNDARY_ARN || `arn:aws:iam::${account}:policy/pulsar-showcase-runtime-boundary`;

  // Do not let a template update undo a previous budget/manual shutdown.
  const previous = spawnSync('aws', [...awsArgs, 'cloudformation', 'describe-stacks', '--stack-name', stack, '--output', 'json'], { cwd, env, encoding: 'utf8' });
  if (previous.error) throw previous.error;
  if (previous.status === 0) {
    const description = JSON.parse(previous.stdout) as StackDescription;
    if (!description.Stacks[0]?.Outputs?.some((output) => output.OutputKey === 'SiteUrl')) {
      throw new Error('Existing stack has no SiteUrl; inspect its status before updating.');
    }
    for (const name of ['get-ad', 'post-events', 'get-stats', 'site']) {
      const concurrency = aws<{ ReservedConcurrentExecutions?: number }>(['lambda', 'get-function-concurrency', '--function-name', `${stack}-${name}`]);
      if (concurrency.ReservedConcurrentExecutions === 0) throw new Error(`${stack}-${name} is stopped. Review spending and recover manually before redeploying.`);
    }
  } else if (!/\(ValidationError\)[\s\S]*does not exist/.test(previous.stderr)) {
    throw new Error(`Unable to inspect existing stack: ${previous.stderr || previous.status}`);
  }

  run('npm', ['run', 'build']);
  run('npm', ['run', 'typecheck']);
  run('sam', ['validate', '--lint', '--template-file', 'backend/template.yaml', '--profile', profile, '--region', region]);
  run('sam', ['build', '--template-file', 'backend/template.yaml', '--profile', profile, '--region', region]);

  const artifacts = `${stack}-artifacts-${account}-${region}`;
  const bucket = spawnSync('aws', [...awsArgs, 's3api', 'head-bucket', '--bucket', artifacts, '--expected-bucket-owner', account], { cwd, env, encoding: 'utf8' });
  if (bucket.error) throw bucket.error;
  if (bucket.status !== 0) {
    if (!/\((?:404|NotFound|NoSuchBucket)\)/.test(bucket.stderr)) throw new Error(`Cannot access artifact bucket; refusing to treat it as missing: ${bucket.stderr}`);
    const args = ['s3api', 'create-bucket', '--bucket', artifacts];
    if (region !== 'us-east-1') args.push('--create-bucket-configuration', `LocationConstraint=${region}`);
    run('aws', [...awsArgs, ...args]);
    run('aws', [...awsArgs, 's3api', 'head-bucket', '--bucket', artifacts, '--expected-bucket-owner', account]);
  }
  run('sam', [
    'deploy', '--template-file', '.aws-sam/build/template.yaml', '--stack-name', stack,
    '--profile', profile, '--region', region, '--s3-bucket', artifacts,
    '--no-confirm-changeset', '--no-fail-on-empty-changeset', '--capabilities', 'CAPABILITY_IAM',
    '--tags', 'Project=pulsar-showcase', '--parameter-overrides',
    `DeploymentPermissionsBoundary=${boundary}`, `BudgetEmail=${email}`,
  ]);

  const description = aws<StackDescription>(['cloudformation', 'describe-stacks', '--stack-name', stack]);
  const outputs = Object.fromEntries((description.Stacks[0]?.Outputs || []).map((output) => [output.OutputKey, output.OutputValue]));
  for (const key of ['ApiUrl', 'TableName', 'SiteBucketName', 'SiteUrl']) {
    if (!outputs[key]) throw new Error(`Stack output ${key} is missing.`);
  }
  run('npm', ['run', 'build', '--workspace=@pulsar/demo'], { ...env, VITE_API_URL: outputs.ApiUrl });
  const seedEnv: NodeJS.ProcessEnv = { ...env, TABLE_NAME: outputs.TableName, CREATIVE_BASE_URL: `${outputs.SiteUrl.replace(/\/+$/, '')}/creatives` };
  delete seedEnv.DYNAMODB_ENDPOINT;
  // Keep the SDK on the same named profile as the CLI, not ambient access keys.
  delete seedEnv.AWS_ACCESS_KEY_ID;
  delete seedEnv.AWS_SECRET_ACCESS_KEY;
  delete seedEnv.AWS_SESSION_TOKEN;
  run('npm', ['run', 'seed'], seedEnv);
  const destination = `s3://${outputs.SiteBucketName}/`;
  run('aws', [...awsArgs, 's3', 'sync', 'demo/dist/', destination, '--delete', '--cache-control', 'public,max-age=60']);
  run('aws', [...awsArgs, 's3', 'cp', 'demo/dist/assets/', `${destination}assets/`, '--recursive', '--cache-control', 'public,max-age=31536000,immutable']);
  run('aws', [...awsArgs, 's3', 'cp', 'demo/dist/', destination, '--recursive', '--exclude', '*', '--include', '*.svg', '--cache-control', 'public,max-age=3600']);
  console.log(`Showcase: ${outputs.SiteUrl}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
