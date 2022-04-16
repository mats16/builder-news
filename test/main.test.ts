import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { RssSummaryStack } from '../src/rss-summary-stack';

test('Snapshot', () => {
  const app = new App();
  const stack = new RssSummaryStack(app, 'test');

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});