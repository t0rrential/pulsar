import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const profile = process.env.AWS_PROFILE || 'pulsar';
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const stack = 'pulsar-showcase';
const env = { ...process.env, AWS_PROFILE: profile, AWS_REGION: region, AWS_DEFAULT_REGION: region, AWS_PAGER: '' };
const awsArgs = ['--profile', profile, '--region', region, '--no-cli-pager'];

function aws<T>(args: string[]): T {
  const output = execFileSync('aws', [...awsArgs, ...args, '--output', 'json'], { cwd, env, encoding: 'utf8' }).trim();
  return (output ? JSON.parse(output) : {}) as T;
}

function run(args: string[]): void {
  execFileSync('aws', [...awsArgs, ...args], { cwd, env, stdio: 'inherit' });
}

try {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--confirm') {
    throw new Error('This permanently deletes showcase counters and site assets. Run npm run showcase:delete -- --confirm to proceed.');
  }
  const identity = aws<{ Account: string; Arn: string }>(['sts', 'get-caller-identity']);
  if (!/^\d{12}$/.test(identity.Account) || !identity.Arn) throw new Error('AWS returned no valid account identity.');
  if (identity.Arn.endsWith(':root')) throw new Error('Root credentials are forbidden. Use a non-root AWS profile.');
  const description = aws<{ Stacks: { Outputs?: { OutputKey: string; OutputValue: string }[] }[] }>(['cloudformation', 'describe-stacks', '--stack-name', stack]);
  const siteBucket = description.Stacks[0]?.Outputs?.find((output) => output.OutputKey === 'SiteBucketName')?.OutputValue;
  if (!siteBucket) throw new Error('Stack has no SiteBucketName output; refusing to guess which bucket to empty.');
  run(['s3api', 'head-bucket', '--bucket', siteBucket, '--expected-bucket-owner', identity.Account]);
  console.log(`Deleting ${stack} in account ${identity.Account}, region ${region}; emptying only ${siteBucket}.`);
  run(['s3', 'rm', `s3://${siteBucket}/`, '--recursive']);
  run(['cloudformation', 'delete-stack', '--stack-name', stack]);
  run(['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', stack]);
  console.log(`Deleted ${stack}. Artifact bucket ${stack}-artifacts-${identity.Account}-${region} and operator IAM identity were intentionally retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
