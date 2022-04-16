import { App } from 'aws-cdk-lib';
import { RssSummaryStack } from './rss-summary-stack';

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new RssSummaryStack(app, 'rss-summary-dev', { env: devEnv });
// new MyStack(app, 'rss-sumally-prod', { env: prodEnv });

app.synth();