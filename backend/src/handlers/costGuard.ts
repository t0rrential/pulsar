import type { SNSHandler } from 'aws-lambda';
import { LambdaClient, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

export const handler: SNSHandler = async (event) => {
  const topicArn = process.env.BUDGET_TOPIC_ARN;
  const functionNames = process.env.SHOWCASE_FUNCTION_NAMES?.split(',');
  if (!topicArn || !functionNames?.length) {
    throw new Error('Cost guard configuration is incomplete.');
  }
  if (!event.Records.length || event.Records.some((record) => record.Sns.TopicArn !== topicArn)) {
    throw new Error('Cost guard accepts only its configured budget topic.');
  }

  // Attempt every shutdown operation even if one service fails. Throwing lets SNS/Lambda retry.
  const outcomes = await Promise.allSettled(functionNames.map((FunctionName) =>
    lambda.send(new PutFunctionConcurrencyCommand({ FunctionName, ReservedConcurrentExecutions: 0 })),
  ));
  const errors = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (errors.length) throw new AggregateError(errors.map((outcome) => outcome.reason), 'Showcase shutdown was incomplete.');
  console.log('Budget shutdown applied: all API and website Lambda concurrency limits are zero.');
};
