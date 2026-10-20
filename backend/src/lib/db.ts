import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT;

const configuredTableName = process.env.TABLE_NAME;
if (!configuredTableName) {
  throw new Error('TABLE_NAME environment variable is required');
}
export const tableName = configuredTableName;

export const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? (endpoint ? 'us-east-1' : undefined),
    ...(endpoint
      ? {
          endpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  }),
);
