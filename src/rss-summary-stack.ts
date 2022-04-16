import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class RssSummaryStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'Bucket');

    const translateStatement = new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    });

    const createSummaryFunction = new NodejsFunction(this, 'CreateSummaryFunction', {
      description: 'Create summary',
      entry: './src/functions/create-summary/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      architecture: lambda.Architecture.ARM_64,
      //memorySize: 256,
      timeout: Duration.minutes(5),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'CreateSummaryFunction',
        POWERTOOLS_METRICS_NAMESPACE: this.stackName,
        POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'false',
        RSS_URL: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
        BUCKET_NAME: bucket.bucketName,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    bucket.grantPut(createSummaryFunction);
    createSummaryFunction.addToRolePolicy(translateStatement);

    const rule = new events.Rule(this, 'sampleRule', {
      //schedule: events.Schedule.expression('cron(0 23 ? * MON-FRI *)'),
      schedule: events.Schedule.expression('cron(0/5 * ? * * *)'), // test
    });

    rule.addTarget(new targets.LambdaFunction(createSummaryFunction));

    new cf.Distribution(this, 'Distribution', {
      comment: 'Summary',
      defaultBehavior: {
        origin: new S3Origin(bucket),
      },
      enableIpv6: true,
    });

  }
}
