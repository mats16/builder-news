const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  projenVersion: '0.71.11',
  cdkVersion: '2.74.0',
  defaultReleaseBranch: 'main',
  name: 'daily-aws-news',
  deps: [
    '@aws-lambda-powertools/logger@1.14.0',
    '@aws-lambda-powertools/metrics@1.14.0',
    '@aws-lambda-powertools/tracer@1.14.0',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-translate',
    '@types/aws-lambda',
    'axios',
    'bluebird@3.7.2',
    'feed@4.2.2',
    'markdown-doc-builder@1.3.0',
    'rss-parser@3.12.0',
  ],
  devDeps: [
    '@types/bluebird',
    'canvas@2.11.2',
  ],
  gitignore: [
    'hugo/public',
  ],
  tsconfig: {
    compilerOptions: {
      noUnusedLocals: false,
      noUnusedParameters: false,
    },
  },
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();