//import { Logger } from '@aws-lambda-powertools/logger';
//import { Metrics } from '@aws-lambda-powertools/metrics';
//import { Tracer } from '@aws-lambda-powertools/tracer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { Handler } from 'aws-lambda';
import markdown from 'markdown-doc-builder';
import Parser from 'rss-parser';

const bucketName = process.env.BUCKET_NAME!;

//const logger = new Logger();
//const metrics = new Metrics();
//const tracer = new Tracer();

const parser = new Parser();
const s3 = new S3Client({});

const translate = async (text: string, sourceLanguageCode: string, targetLanguageCode: string) => {
  const client = new TranslateClient({});
  const cmd = new TranslateTextCommand({
    Text: text,
    SourceLanguageCode: sourceLanguageCode,
    TargetLanguageCode: targetLanguageCode,
  });
  const { TranslatedText } = await client.send(cmd);
  return TranslatedText || text;
};

const getFeed = async (feedUrl: string, oldestPubDate: Date, latestPubDate: Date) => {
  const feed = await parser.parseURL(feedUrl);
  feed.items = feed.items.filter((item) => {
    const pubDate = new Date(item.pubDate!);
    return (pubDate > oldestPubDate && pubDate <= latestPubDate);
  });
  return feed;
};

interface Event {
  lang?: string;
  input?: any;
};

export const handler: Handler = async (event: Event, _context) => {
  const lang = event.lang || 'en';
  const time: string|undefined = event.input?.time; // 2022-04-14T12:10:00Z

  const executedDate = (typeof time == 'string')
    ? new Date(time)
    : new Date();

  const latestPubDate = new Date(executedDate);
  latestPubDate.setDate(latestPubDate.getDate() + 1);
  latestPubDate.setHours(0, 0, 0, 0);

  const oldestPubDate = new Date(latestPubDate);
  if (latestPubDate.getDay() == 1) {
    oldestPubDate.setDate(latestPubDate.getDate() - 3);
  } else {
    oldestPubDate.setDate(latestPubDate.getDate() - 1);
  };

  const summaryDateString = oldestPubDate.toISOString().split('T')[0];
  const summaryTitle = `${summaryDateString} AWS Updates`;
  const summaryObjectKey = `hugo/content/posts/${summaryDateString}.${lang}.md`;

  const mdBody = markdown.newBuilder()
    .headerOrdered(false)
    .text('---').newline()
    .text( `date: ${executedDate.toISOString()}`).newline()
    .text( `title: ${summaryTitle}`).newline()
    .text('categories:')
    .list(['aws'])
    .text('---').newline();

  mdBody.text(`${oldestPubDate.toUTCString()} ~ ${executedDate.toUTCString()}`).newline();

  await (async() => {
    const siteName ='What\'s New with AWS?';
    const siteUrl = 'https://aws.amazon.com/new/';
    const feedUrl = 'https://aws.amazon.com/new/feed/';
    mdBody.h2(`[${siteName}](${siteUrl})`);
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      for await (let item of items) {
        let { title, link, contentSnippet } = item;
        if (lang != 'en') {
          contentSnippet = await translate(contentSnippet!, 'en', lang);
        };
        mdBody.h4(`[${title}](${link})`);
        mdBody.blockQuote(contentSnippet!);
      };
    } else {
      mdBody.text('No updates.').newline();
    };
  })();

  mdBody.h2('Blogs');

  await (async() => {
    const feedUrl = 'https://aws.amazon.com/jp/blogs/news/feed/';
    const { title: siteTitle, link: siteLink, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      if (lang == 'ja') {
        mdBody.h3(`[${siteTitle}](${siteLink})`);
      } else {
        mdBody.h3(`[AWS Japan Blog (Japanese)](${siteLink})`);
      };
      for await (let item of items) {
        let { title, link } = item;
        if (lang != 'ja') {
          title = await translate(title!, 'ja', lang);
        };
        mdBody.text(`1. [${title}](${link})\n`);
      };
    };
  })();

  await (async() => {
    const feedUrl = 'https://aws.amazon.com/jp/blogs/startup/feed/';
    const { title: siteTitle, link: siteLink, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      if (lang == 'ja') {
        mdBody.h3(`[${siteTitle}](${siteLink})`);
      } else {
        mdBody.h3(`[AWS Japan Startup Blog (Japanese)](${siteLink})`);
      };
      for await (let item of items) {
        let { title, link } = item;
        if (lang != 'ja') {
          title = await translate(title!, 'ja', lang);
        };
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const feedUrl = 'https://aws.amazon.com/blogs/aws/feed/';
    const { title: siteTitle, link: siteLink, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteTitle}](${siteLink})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const feedUrl = 'https://aws.amazon.com/blogs/startups/feed/';
    const { title: siteTitle, link: siteLink, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteTitle}](${siteLink})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const feedUrl = 'https://aws.amazon.com/blogs/opensource/feed/';
    const { title: siteTitle, link: siteLink, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteTitle}](${siteLink})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  })();

  mdBody.h2('Open Source Releases');

  await (async() => {
    const siteName ='AWS CDK';
    const siteUrl = 'https://github.com/aws/aws-cdk/';
    const feedUrl = 'https://github.com/aws/aws-cdk/releases.atom';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteName}](${siteUrl})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const siteName ='AWS Amplify CLI';
    const siteUrl = 'https://github.com/aws-amplify/amplify-cli/';
    const feedUrl = 'https://github.com/aws-amplify/amplify-cli/releases.atom';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteName}](${siteUrl})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const siteName ='AWS Copilot CLI';
    const siteUrl = 'https://github.com/aws/copilot-cli/';
    const feedUrl = 'https://github.com/aws/copilot-cli/releases.atom';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteName}](${siteUrl})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  })();

  await (async() => {
    const siteName ='Bottlerocket OS';
    const siteUrl = 'https://github.com/bottlerocket-os/bottlerocket/';
    const feedUrl = 'https://github.com/bottlerocket-os/bottlerocket/releases.atom';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteName}](${siteUrl})`);
      for await (let item of items) {
        let { title, link } = item;
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  })();

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: summaryObjectKey,
    Body: mdBody.toMarkdown(),
  }));

  return { bucket: bucketName, key: summaryObjectKey };
};
