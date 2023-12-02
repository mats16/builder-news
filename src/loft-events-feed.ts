import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as events from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaFunctionTarget } from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface LoftEventsFeedProps {
  bucket: s3.IBucket;
  distribution: cf.IDistribution;
}

export class LoftEventsFeed extends Construct {
  constructor(scope: Construct, id: string, props: LoftEventsFeedProps) {
    super(scope, id);

    const { bucket, distribution } = props;

    const feedKey = 'startup/loft/tokyo/events';

    /** 記事の Markdown を生成する Lambda Function */
    const generateFeedFunction = new NodejsFunction(this, 'GenerateFeedFunction', {
      description: 'Generate feed',
      entry: './src/functions/gen-loft-events-feed/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(1),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        FEED_KEY: feedKey,
        DISTRIBUTION_ID: distribution.distributionId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    /** S3 への書き込み権限を付与 */
    bucket.grantReadWrite(generateFeedFunction, feedKey);

    new events.Rule(this, 'ScheduledFeedGeneration', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new LambdaFunctionTarget(generateFeedFunction, { retryAttempts: 0 })],
    });

  }
}
