import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HugoStack } from '../src/hugo-auto-generating-stack';

test('Snapshot', () => {
  const app = new App();
  const stack = new HugoStack(app, 'test');

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});