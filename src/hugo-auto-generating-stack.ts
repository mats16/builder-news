import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
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
    customDomainNames?: string[];
    acmArn?: string;
    hugoEnv?: string;
    hugoGoogleAnalytics?: string;
    hugoDisqusShortname?: string;
  };
}

export class HugoStack extends Stack {
  constructor(scope: Construct, id: string, props: HugoStackProps = { config: {} }) {
    super(scope, id, props);

    const { customDomainNames, acmArn, hugoEnv, hugoGoogleAnalytics, hugoDisqusShortname } = props.config;

    const hugoVersion = '0.98.0';

    const buildSourcePath = 'source';
    const buildCachePath = 'cache';
    const buildArtifactsPath = 'artifacts';

    const artifactName = 'staticPages';

    const hugoContentPath = `${buildSourcePath}/content`;

    const bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      eventBridgeEnabled: true,
    });

    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./hugo')],
      destinationBucket: bucket,
      destinationKeyPrefix: `${buildSourcePath}/`,
      prune: false,
    });

    const urlRewriteFunction = new cf.Function(this, 'UrlRewriteFunction', {
      comment: 'URL rewrite to append index.html to the URI',
      code: cf.FunctionCode.fromFile({
        filePath: './src/functions/url-rewrite/index.js',
      }),
    });

    const cfDistribution = new cf.Distribution(this, 'Distribution', {
      comment: 'Daily AWS',
      domainNames: (typeof customDomainNames == 'undefined') ? undefined : customDomainNames,
      certificate: (typeof acmArn == 'undefined') ? undefined : acm.Certificate.fromCertificateArn(this, 'Certificate', acmArn),
      defaultBehavior: {
        origin: new S3Origin(bucket, { originPath: `${buildArtifactsPath}/${artifactName}` }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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

    //const createInvalidationStatement = new iam.PolicyStatement({
    //  actions: ['cloudfront:CreateInvalidation'],
    //  resources: [`arn:aws:cloudfront::${this.account}:distribution/${cfDistribution.distributionId}`],
    //});

    const buildEnvironmentVariables: {[name: string]: codebuild.BuildEnvironmentVariable} = {
      HUGO_BINARY_URL: { value: `https://github.com/gohugoio/hugo/releases/download/v${hugoVersion}/hugo_${hugoVersion}_Linux-64bit.tar.gz` },
      HUGO_BINARY_LOCAL: { value: `/tmp/hugo_${hugoVersion}.tar.gz` },
      HUGO_BASEURL: { value: `https://${customDomainNames?.[0]||cfDistribution.distributionDomainName}/` },
      HUGO_PARAMS_ENV: { value: hugoEnv || 'development' },
      //DISTRIBUTION_ID: { value: cfDistribution.distributionId },
    };
    if (typeof hugoDisqusShortname == 'string') {
      buildEnvironmentVariables.HUGO_PARAMS_COMMENTS = { value: true };
      buildEnvironmentVariables.HUGO_DISQUSSHORTNAME = { value: hugoDisqusShortname };
    };
    if (typeof hugoGoogleAnalytics == 'string') {
      buildEnvironmentVariables.HUGO_GOOGLEANALYTICS = { value: hugoGoogleAnalytics };
    };

    const buildProject = new codebuild.Project(this, 'BuildStaticPages', {
      description: 'Hugo - Build static pages',
      source: codebuild.Source.s3({
        bucket: bucket,
        path: `${buildSourcePath}/`,
      }),
      artifacts: codebuild.Artifacts.s3({
        bucket: bucket,
        path: buildArtifactsPath,
        encryption: false,
        packageZip: false,
        includeBuildId: false,
      }),
      cache: codebuild.Cache.bucket(bucket, { prefix: buildCachePath }),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_5_0 },
      timeout: Duration.minutes(10),
      environmentVariables: buildEnvironmentVariables,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'if [ ! -e ${HUGO_BINARY_LOCAL} ] ;then curl -L ${HUGO_BINARY_URL} -o ${HUGO_BINARY_LOCAL}; else echo "get hugo binary from cache"; fi',
              'tar -zxf ${HUGO_BINARY_LOCAL} -C /usr/local/bin',
            ],
          },
          build: {
            commands: ['hugo --buildDrafts'],
          },
          //post_build: {
          //  commands: [
          //    'aws cloudfront create-invalidation --distribution-id ${DISTRIBUTION_ID} --paths "/*"',
          //  ],
          //},
        },
        artifacts: {
          'name': artifactName,
          'base-directory': 'public',
          'files': ['**/*'],
        },
        cache: {
          paths: ['${HUGO_BINARY_LOCAL}'],
        },
      }),
    });
    //buildProject.addToRolePolicy(createInvalidationStatement);

    const translateStatement = new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    });

    const createArticleFunction = new NodejsFunction(this, 'CreateArticleFunction', {
      description: 'Create new article',
      entry: './src/functions/create-post/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_14_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(3),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'CreateArticleFunction',
        POWERTOOLS_METRICS_NAMESPACE: this.stackName,
        POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'false',
        BUCKET_NAME: bucket.bucketName,
        HUGO_CONTENT_PATH: hugoContentPath,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    bucket.grantReadWrite(createArticleFunction, `${hugoContentPath}/*.md`);
    createArticleFunction.addToRolePolicy(translateStatement);

    const createThumbnailFunction = new lambda.DockerImageFunction(this, 'CreateThumbnailFunction', {
      description: 'Create thumbnail image and put to S3',
      code: lambda.DockerImageCode.fromImageAsset('./src/functions/create-thumbnail/'),
      architecture: lambda.Architecture.X86_64,
      timeout: Duration.minutes(3),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        HUGO_CONTENT_PATH: hugoContentPath,
        ICON_PATH: `${buildSourcePath}/static/icons/icon-100.png`,
        SITE_NAME: 'Daily AWS',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    bucket.grantRead(createThumbnailFunction, `${buildSourcePath}/*.png`);
    bucket.grantPut(createThumbnailFunction, `${hugoContentPath}/*.png`);

    const genEnglishArticleTask = new sfnTasks.LambdaInvoke(this, 'English Article', {
      lambdaFunction: createArticleFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'en',
      }),
    });

    const genJapaneseArticleTask = new sfnTasks.LambdaInvoke(this, 'Japanese Article', {
      lambdaFunction: createArticleFunction,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.entirePayload,
        lang: 'ja',
      }),
    });

    const genEnglisThumbnailTask = new sfnTasks.LambdaInvoke(this, 'Englis Thumbnail', {
      lambdaFunction: createThumbnailFunction,
    });
    genEnglishArticleTask.next(genEnglisThumbnailTask);

    const genJapaneseThumbnailTask = new sfnTasks.LambdaInvoke(this, 'Japanese Thumbnail', {
      lambdaFunction: createThumbnailFunction,
    });
    genJapaneseArticleTask.next(genJapaneseThumbnailTask);

    const buildStaticPagesTask = new sfnTasks.CodeBuildStartBuild(this, 'Build static pages', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      project: buildProject,
    });

    const cacheInvalidationTask = new sfnTasks.CallAwsService(this, 'Cache invalidation', {
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

    const genArticleTask = new sfn.Parallel(this, 'Generate Article').branch(genJapaneseArticleTask).branch(genEnglishArticleTask);
    genArticleTask.next(buildStaticPagesTask).next(cacheInvalidationTask);

    const dailyJob = new sfn.StateMachine(this, 'DailyJob', {
      definition: genArticleTask,
    });

    const weekday9amRule = new events.Rule(this, 'Weekday9amRule', {
      description: '[JST] 9AM Weekday',
      schedule: events.Schedule.expression('cron(0 0 ? * MON-FRI *)'),
    });
    weekday9amRule.addTarget(new targets.SfnStateMachine(dailyJob, {
      maxEventAge: Duration.hours(1),
      retryAttempts: 3,
      input: events.RuleTargetInput.fromObject({
        time: events.EventField.time,
        isDraft: false,
      }),
    }));

    const everyday7amRule = new events.Rule(this, 'Everyday7amRule', {
      description: '[JST] 7AM Everyday - for Draft',
      schedule: events.Schedule.expression('cron(0 22 ? * * *)'),
    });
    everyday7amRule.addTarget(new targets.SfnStateMachine(dailyJob, {
      maxEventAge: Duration.hours(1),
      retryAttempts: 3,
      input: events.RuleTargetInput.fromObject({
        time: events.EventField.time,
        isDraft: true,
      }),
    }));

    //const hugoConfigChanedRule = new events.Rule(this, 'HugoConfigChanedRule', {
    //  description: 'Hugo config is changed',
    //  eventPattern: {
    //    source: ['aws.s3'],
    //    detailType: ['Object Created'],
    //    detail: {
    //      bucket: {
    //        name: [bucket.bucketName],
    //      },
    //      object: {
    //        key: ['hugo/config.yml'],
    //      },
    //    },
    //  },
    //});
    //hugoConfigChanedRule.addTarget(new targets.CodeBuildProject(buildProject));

    new CfnOutput(this, 'url', { value: `https://${customDomainNames?.[0]||cfDistribution.distributionDomainName}/` });
  }
}
