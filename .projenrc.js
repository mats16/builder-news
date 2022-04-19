const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.20.0',
  defaultReleaseBranch: 'main',
  name: 'rss-summary',
  deps: [
    '@aws-lambda-powertools/commons',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/metrics',
    '@aws-lambda-powertools/tracer',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-translate',
    '@types/aws-lambda',
    'markdown-doc-builder@1.3.0',
    'rss-parser',
  ],
  gitignore: [
    'hugo/content',
    'hugo/public',
  ],
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();