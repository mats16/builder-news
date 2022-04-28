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

    const hugoBucketPath = 'hugo';
    const hugoContentBucketPath = `${hugoBucketPath}/content`;
    const hugoPublicBucketPath = `${hugoBucketPath}/public`;

    const bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      eventBridgeEnabled: true,
    });

    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./hugo')],
      destinationBucket: bucket,
      destinationKeyPrefix: `${hugoBucketPath}/`,
      prune: false,
    });

    const translateStatement = new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    });

    const createPostFunction = new NodejsFunction(this, 'CreatePostFunction', {
      description: 'Create new post',
      entry: './src/functions/create-post/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(3),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'CreatePostFunction',
        POWERTOOLS_METRICS_NAMESPACE: this.stackName,
        POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'false',
        HUGO_CONTENT_BUCKET_NAME: bucket.bucketName,
        HUGO_CONTENT_BUCKET_PATH: hugoContentBucketPath,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    bucket.grantReadWrite(createPostFunction, `${hugoContentBucketPath}/*.md`);
    createPostFunction.addToRolePolicy(translateStatement);

    const createThumbnailFunction = new lambda.DockerImageFunction(this, 'CreateThumbnailFunction', {
      description: 'Create thumbnail image and put to S3',
      code: lambda.DockerImageCode.fromImageAsset('./src/functions/create-thumbnail/'),
      architecture: lambda.Architecture.X86_64,
      timeout: Duration.minutes(3),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'CreateThumbnailFunction',
        POWERTOOLS_METRICS_NAMESPACE: this.stackName,
        POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'false',
        HUGO_CONTENT_BUCKET_NAME: bucket.bucketName,
        HUGO_CONTENT_BUCKET_PATH: hugoContentBucketPath,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    bucket.grantPut(createThumbnailFunction, `${hugoContentBucketPath}/*.png`);

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
        origin: new S3Origin(bucket, { originPath: `/${hugoPublicBucketPath}` }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
        functionAssociations: [
          {
            eventType: cf.FunctionEventType.VIEWER_REQUEST,
            function: urlRewriteFunction,
          },
        ],
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, ttl: Duration.days(1), responsePagePath: '/404.html', responseHttpStatus: 404 },
        { httpStatus: 404, ttl: Duration.days(1), responsePagePath: '/404.html' },
      ],
    });

    const buildProject = new codebuild.Project(this, 'BuildStaticPages', {
      description: 'Hugo - Build static pages',
      source: codebuild.Source.s3({
        bucket: bucket,
        path: `${hugoBucketPath}/`,
      }),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_5_0 },
      timeout: Duration.minutes(10),
      environmentVariables: {
        HUGO_DOWNLOAD_URL: { value: 'https://github.com/gohugoio/hugo/releases/download/v0.97.0/hugo_0.97.0_Linux-64bit.tar.gz' },
        HUGO_BUCKET_NAME: { value: bucket.bucketName },
        HUGO_PUBLIC_BUCKET_PATH: { value: hugoPublicBucketPath },
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
              'hugo --buildDrafts --buildFuture',
              'aws s3 sync --delete ./public/ s3://${HUGO_BUCKET_NAME}/${HUGO_PUBLIC_BUCKET_PATH}/',
            ],
          },
        },
      }),
    });
    bucket.grantRead(buildProject, `${hugoBucketPath}/*`);
    bucket.grantWrite(buildProject, `${hugoPublicBucketPath}/*`);

    const createEnglishPostTask = new sfnTasks.LambdaInvoke(this, 'Create English Post', {
      lambdaFunction: createPostFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'en',
      }),
    });

    const createJapanesePostTask = new sfnTasks.LambdaInvoke(this, 'Create Japanese Post', {
      lambdaFunction: createPostFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'ja',
      }),
    });

    const createEnglisThumbnailTask = new sfnTasks.LambdaInvoke(this, 'Create Englis Thumbnail', {
      lambdaFunction: createThumbnailFunction,
    });
    createEnglishPostTask.next(createEnglisThumbnailTask);

    const createJapaneseThumbnailTask = new sfnTasks.LambdaInvoke(this, 'Create Japanese Thumbnail', {
      lambdaFunction: createThumbnailFunction,
    });
    createJapanesePostTask.next(createJapaneseThumbnailTask);

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

    new events.Rule(this, 'ScheduledStablePostRule', {
      description: 'Create stable post for Hugo every day',
      schedule: events.Schedule.expression('cron(0 0 ? * MON-SAT *)'),
      targets: [new targets.SfnStateMachine(generateHugoContentsJob, {
        maxEventAge: Duration.hours(1),
        retryAttempts: 3,
        input: events.RuleTargetInput.fromObject({
          time: events.EventField.time,
          isDraft: false,
        }),
      })],
    });

    new events.Rule(this, 'ScheduledDraftPost', {
      description: 'Create draft post for Hugo every day',
      schedule: events.Schedule.expression('cron(0 22 ? * SUN-FRI *)'),
      targets: [new targets.SfnStateMachine(generateHugoContentsJob, {
        maxEventAge: Duration.hours(1),
        retryAttempts: 3,
        input: events.RuleTargetInput.fromObject({
          time: events.EventField.time,
          isDraft: true,
        }),
      })],
    });

    const hugoConfigChanedRule = new events.Rule(this, 'HugoConfigChaned', {
      description: 'Rebuild static pages, because Hugo config changed',
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
    hugoConfigChanedRule.addTarget(new targets.CodeBuildProject(buildProject));

    this.exportValue(`https://${cfCname||cfDistribution.distributionDomainName}/`, { name: 'Url' });
  }
}
