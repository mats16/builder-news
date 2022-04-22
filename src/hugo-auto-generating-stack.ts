import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

interface HugoStackProps extends StackProps {
  config: {
    cfCname?: string;
    acmArn?: string;
    hugoEnv?: string;
    hugoGoogleAnalytics?: string;
    hugoDisqusShortname?: string;
  };
}

export class HugoStack extends Stack {
  constructor(scope: Construct, id: string, props: HugoStackProps = { config: {} }) {
    super(scope, id, props);

    const { cfCname, acmArn, hugoEnv, hugoGoogleAnalytics, hugoDisqusShortname } = props.config;

    const bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      eventBridgeEnabled: true,
    });

    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./hugo')],
      destinationBucket: bucket,
      destinationKeyPrefix: 'hugo/',
      prune: false,
    });

    const translateStatement = new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    });

    const createPostFunction = new NodejsFunction(this, 'CreatePostFunction', {
      description: 'Create new post',
      entry: './src/functions/create-summary/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(3),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'CreatePostFunction',
        POWERTOOLS_METRICS_NAMESPACE: this.stackName,
        POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'false',
        BUCKET_NAME: bucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    bucket.grantPut(createPostFunction, 'hugo/content/*');
    createPostFunction.addToRolePolicy(translateStatement);

    const urlRewriteFunction = new cf.Function(this, 'UrlRewriteFunction', {
      code: cf.FunctionCode.fromFile({
        filePath: './src/functions/url-rewrite/index.js',
      }),
    });

    const cfDistribution = new cf.Distribution(this, 'Distribution', {
      comment: 'Builder News',
      domainNames: (typeof cfCname == 'undefined') ? undefined : [cfCname],
      certificate: (typeof acmArn == 'undefined') ? undefined : acm.Certificate.fromCertificateArn(this, 'Certificate', acmArn),
      defaultBehavior: {
        origin: new S3Origin(bucket, { originPath: '/hugo/public' }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
        functionAssociations: [
          {
            eventType: cf.FunctionEventType.VIEWER_REQUEST,
            function: urlRewriteFunction,
          },
        ],
      },
      defaultRootObject: 'index.html',
      errorResponses: [{ httpStatus: 404, ttl: Duration.days(1), responsePagePath: '/404.html' }],
    });

    const buildProject = new codebuild.Project(this, 'BuildStaticPages', {
      description: 'Hugo - Build static pages',
      source: codebuild.Source.s3({
        bucket: bucket,
        path: 'hugo/',
      }),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_5_0 },
      timeout: Duration.minutes(10),
      environmentVariables: {
        HUGO_DOWNLOAD_URL: { value: 'https://github.com/gohugoio/hugo/releases/download/v0.97.0/hugo_0.97.0_Linux-64bit.tar.gz' },
        BUCKET_NAME: { value: bucket.bucketName },
        HUGO_BASEURL: { value: `https://${cfCname||cfDistribution.distributionDomainName}/` },
        HUGO_PARAMS_ENV: { value: hugoEnv || 'development' },
        HUGO_GOOGLEANALYTICS: { value: hugoGoogleAnalytics || '' },
        HUGO_DISQUSSHORTNAME: { value: hugoDisqusShortname || '' },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'rm -rf ./public/*',
              'curl -L ${HUGO_DOWNLOAD_URL} | tar zx -C /usr/local/bin',
              'hugo -D',
              'aws s3 sync --delete ./public/ s3://${BUCKET_NAME}/hugo/public/',
            ],
          },
        },
      }),
    });
    bucket.grantRead(buildProject, 'hugo/*');
    bucket.grantWrite(buildProject, 'hugo/public/*');

    const createEnglishPostTask = new sfnTasks.LambdaInvoke(this, 'Daily AWS EN', {
      lambdaFunction: createPostFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'en',
      }),
    });

    const createJapanesePostTask = new sfnTasks.LambdaInvoke(this, 'Daily AWS JA', {
      lambdaFunction: createPostFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'ja',
      }),
    });

    const hugoBuildTask = new sfnTasks.CodeBuildStartBuild(this, 'Hugo Build', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      project: buildProject,
    });

    const clearCdnCacheTask = new sfnTasks.CallAwsService(this, 'Clear CDN Cache', {
      service: 'CloudFront',
      action: 'createInvalidation',
      parameters: {
        DistributionId: cfDistribution.distributionId,
        InvalidationBatch: {
          'CallerReference.$': '$.SdkResponseMetadata.RequestId',
          'Paths': {
            Items: ['/*'],
            Quantity: 1,
          },
        },
      },
      iamResources: [`arn:aws:cloudfront::${this.account}:distribution/${cfDistribution.distributionId}`],
      iamAction: 'cloudfront:CreateInvalidation',
    });

    const createSummaryTask = new sfn.Parallel(this, 'Create Summary').branch(createJapanesePostTask).branch(createEnglishPostTask);
    createSummaryTask.next(hugoBuildTask).next(clearCdnCacheTask);

    const generateHugoContentsJob = new sfn.StateMachine(this, 'GenerateHugoContents', {
      definition: createSummaryTask,
    });

    const scheduledHugoBuildRule = new events.Rule(this, 'ScheduledHugoBuild', {
      description: 'Create hugo contents every day',
      schedule: events.Schedule.expression('cron(59 21,23 ? * MON-FRI *)'),
      //schedule: events.Schedule.expression('cron(59 * ? * MON-FRI *)'),
    });
    scheduledHugoBuildRule.addTarget(new targets.SfnStateMachine(generateHugoContentsJob));

    const hugoConfigChanedRure = new events.Rule(this, 'HugoConfigChaned', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [bucket.bucketName],
          },
          object: {
            key: [{ prefix: 'hugo/config.' }],
          },
        },
      },
    });
    hugoConfigChanedRure.addTarget(new targets.CodeBuildProject(buildProject));

    this.exportValue(`https://${cfCname||cfDistribution.distributionDomainName}/`, { name: 'Url' });
  }
}
