import { App } from 'aws-cdk-lib';
import { HugoStack } from './hugo-auto-generating-stack';

// for development, use account/region from cdk cli
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const hugoConfig = {
  domainName: process.env.HUGO_DOMAIN_NAME,
  env: process.env.HUGO_ENV,
};

const app = new App();

new HugoStack(app, 'builder-news-dev', { env, hugoConfig });
// new MyStack(app, 'rss-sumally-prod', { env: prodEnv });

app.synth();