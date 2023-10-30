import { Stack, StackProps, Duration, CfnOutput, Aws } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
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
import { LoftEventsFeed } from './loft-events-feed';

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

    const hugoVersion = '0.111.3';

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

    /** URL を書き換える CloudFront Function */
    const urlRewriteFunction = new cf.Function(this, 'UrlRewriteFunction', {
      comment: 'URL rewrite to append index.html to the URI',
      code: cf.FunctionCode.fromFile({
        filePath: './src/functions/url-rewrite/index.js',
      }),
    });

    /** CloudFront Distribution */
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

    // Loft 関連の Assets Path
    cfDistribution.addBehavior('startup/*', new S3Origin(bucket), {
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    });

    // Feed を定期的に作成・更新するジョブ
    new LoftEventsFeed(this, 'LoftEventsFeed', {
      bucket: bucket,
      distribution: cfDistribution,
    });

    const hugoBaseUrl = `https://${customDomainNames?.[0]||cfDistribution.distributionDomainName}/`;

    /** CodeBuild の環境変数 */
    const buildEnvironmentVariables: {[name: string]: codebuild.BuildEnvironmentVariable} = {
      HUGO_BINARY_URL: { value: `https://github.com/gohugoio/hugo/releases/download/v${hugoVersion}/hugo_${hugoVersion}_Linux-64bit.tar.gz` },
      HUGO_BINARY_LOCAL: { value: `/tmp/hugo_${hugoVersion}.tar.gz` },
      HUGO_BASEURL: { value: hugoBaseUrl },
      HUGO_PARAMS_ENV: { value: hugoEnv || 'development' },
    };
    if (typeof hugoDisqusShortname == 'string') {
      buildEnvironmentVariables.HUGO_PARAMS_COMMENTS = { value: true };
      buildEnvironmentVariables.HUGO_DISQUSSHORTNAME = { value: hugoDisqusShortname };
    };
    if (typeof hugoGoogleAnalytics == 'string') {
      buildEnvironmentVariables.HUGO_GOOGLEANALYTICS = { value: hugoGoogleAnalytics };
    };

    /** CodeBuild の build project */
    const buildProject = new codebuild.Project(this, 'BuildStaticPages', {
      description: 'Build static pages with Hugo',
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
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_6_0 },
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

    /** Amazon Translate 用の IAM Policy */
    const translateStatement = new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'],
    });

    /** 記事の Markdown を生成する Lambda Function */
    const createArticleFunction = new NodejsFunction(this, 'CreateArticleFunction', {
      description: 'Create new article',
      entry: './src/functions/create-article/index.ts',
      handler: 'handler',
      bundling: {
        externalModules: [
          '@aws-sdk/*',
          '@aws-lambda-powertools/*',
        ],
      },
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(this, 'LambdaPowertools', `arn:aws:lambda:${Aws.REGION}:094274105915:layer:AWSLambdaPowertoolsTypeScript:21`),
      ],
      runtime: lambda.Runtime.NODEJS_18_X,
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
    /** S3 への書き込み権限を付与 */
    bucket.grantReadWrite(createArticleFunction, `${hugoContentPath}/*.md`);
    /** Amazon Translate の実行権限を付与 */
    createArticleFunction.addToRolePolicy(translateStatement);

    /** サムネイル画像を生成する Lambda Function */
    const createThumbnailFunction = new lambda.DockerImageFunction(this, 'CreateThumbnailFunction', {
      description: 'Create thumbnail image and put to S3',
      code: lambda.DockerImageCode.fromImageAsset('./src/functions/create-thumbnail/', { platform: Platform.LINUX_AMD64 }),
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
    /** ベース画像の読み取り権限を付与 */
    bucket.grantRead(createThumbnailFunction, `${buildSourcePath}/*.png`);
    /** S3 への書き込み権限を付与 */
    bucket.grantPut(createThumbnailFunction, `${hugoContentPath}/*.png`);

    /** CodeBuild の SFn Task */
    const buildStaticPagesTask = new sfnTasks.CodeBuildStartBuild(this, 'BuildStaticPagesTask', {
      comment: 'Build static pages with Hugo',
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      project: buildProject,
    }).addRetry({ maxAttempts: 1 });

    /** CDN のキャッシュを無効化する SFn Task */
    const cacheInvalidationTask = new sfnTasks.CallAwsService(this, 'CacheInvalidationTask', {
      comment: 'Send invalidation to CloudFront (CDN)',
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
    }).addRetry({ maxAttempts: 3 });

    /** 記事を作成する SFn Task */
    const createArticleTask = new sfnTasks.LambdaInvoke(this, 'CreateArticleTask', {
      comment: 'Create content for Hugo',
      lambdaFunction: createArticleFunction,
    });

    /** サムネイル画像を作成する SFn Task */
    const createThumbnailTask = new sfnTasks.LambdaInvoke(this, 'CreateThumbnailTask', {
      comment: 'Create thumbnail image for Hugo',
      lambdaFunction: createThumbnailFunction,
    });
    createArticleTask.next(createThumbnailTask);

    /** 多言語記事を作成する SFn Task */
    const createMutiLangArticleTask = new sfn.Map(this, 'CreateMutiLangArticleTask', {
      itemsPath: sfn.JsonPath.stringAt('$.lang'),
      parameters: {
        'time.$': '$.time',
        'isDraft.$': '$.isDraft',
        'lang.$': '$$.Map.Item.Value',
      },
    });
    createMutiLangArticleTask.iterator(createArticleTask);
    createMutiLangArticleTask.next(buildStaticPagesTask).next(cacheInvalidationTask);

    /** 毎日記事を作成する StateMachine */
    const dailyJob = new sfn.StateMachine(this, 'DailyJob', {
      definition: createMutiLangArticleTask,
    });

    /** 平日９時に記事を生成するルール */
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
        lang: ['ja', 'en'],
      }),
    }));

    /** 毎日７時に速報版の記事を生成するルール */
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
        lang: ['ja', 'en'],
      }),
    }));

    const hugoConfigChanedRule = new events.Rule(this, 'HugoConfigChanedRule', {
      description: 'Hugo config is changed',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [bucket.bucketName],
          },
          object: {
            key: [`${buildSourcePath}/config.yml`],
          },
        },
      },
    });
    hugoConfigChanedRule.addTarget(new targets.SfnStateMachine(dailyJob, {
      maxEventAge: Duration.hours(1),
      retryAttempts: 3,
      input: events.RuleTargetInput.fromObject({
        lang: [], // Only build
      }),
    }));

    new CfnOutput(this, 'url', { value: hugoBaseUrl });
  }
}
