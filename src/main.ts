import { App } from 'aws-cdk-lib';
import { HugoStack } from './hugo-auto-generating-stack';

// for development, use account/region from cdk cli
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const config = {
  customDomainNames: process.env.CUSTOM_DOMAIN_NAMES?.split(','),
  acmArn: process.env.ACM_ARN,
  hugoEnv: process.env.HUGO_ENV,
  hugoGoogleAnalytics: process.env.HUGO_GOOGLEANALYTICS,
  hugoDisqusShortname: process.env.HUGO_DISQUSSHORTNAME,
};

const app = new App();

new HugoStack(app, 'daily-aws-stack', { env, config });

app.synth();