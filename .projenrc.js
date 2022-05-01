const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.22.0',
  defaultReleaseBranch: 'main',
  name: 'builder-news',
  deps: [
    '@aws-lambda-powertools/commons',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/metrics',
    '@aws-lambda-powertools/tracer',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-translate',
    '@types/aws-lambda',
    'bluebird@3.7.2',
    'canvas@2.9.1',
    'markdown-doc-builder@1.3.0',
    'node-fetch',
    'rss-parser@3.12.0',
  ],
  devDeps: [
    '@types/bluebird',
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