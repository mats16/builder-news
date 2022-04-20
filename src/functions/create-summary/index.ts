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

const dataSource = {
  jpBlogs: [
    {
      name: 'AWS Japan Blog (Japanese)',
      url: 'https://aws.amazon.com/jp/blogs/news/',
    },
    {
      name: 'AWS Japan Startup Blog (Japanese)',
      url: 'https://aws.amazon.com/jp/blogs/startup/',
    },
  ],
  blogs: [
    {
      url: 'https://aws.amazon.com/blogs/aws/',
    },
    {
      url: 'https://aws.amazon.com/blogs/startups/',
    },
    {
      url: 'https://aws.amazon.com/blogs/architecture/',
    },
    {
      url: 'https://aws.amazon.com/blogs/security/',
    },
    {
      url: 'https://aws.amazon.com/blogs/opensource/',
    },
  ],
  oss: [
    {
      name: 'AWS CDK',
      url: 'https://github.com/aws/aws-cdk/',
    },
    {
      name: 'OpenSearch',
      url: 'https://github.com/opensearch-project/OpenSearch/',
    },
    {
      name: 'Amazon Chime SDK for JavaScript',
      url: 'https://github.com/aws/amazon-chime-sdk-js/',
    },
    {
      name: 'AWS Copilot CLI',
      url: 'https://github.com/aws/copilot-cli/',
    },
    {
      name: 'Bottlerocket OS',
      url: 'https://github.com/bottlerocket-os/bottlerocket/',
    },
    {
      name: 'AWS Load Balancer Controller',
      url: 'https://github.com/kubernetes-sigs/aws-load-balancer-controller/',
    },
    {
      name: 'Karpenter',
      url: 'https://github.com/aws/karpenter/'
    },
    {
      name: 'Amazon EKS Anywhere',
      url: 'https://github.com/aws/eks-anywhere'
    },
  ]
}

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

  const contentDateString = oldestPubDate.toISOString().split('T')[0];
  const contentTitle = `Daily AWS ${contentDateString}`;
  const contentObjectKey = `hugo/content/posts/daily-aws-${contentDateString}.${lang}.md`;

  // https://gohugo.io/content-management/front-matter/
  const frontMatter = {
    title: contentTitle,
    description: 'AWS News Headlines',
    date: contentDateString,
    lastmod: executedDate.toISOString(),
    categories: [
      'aws'
    ],
  };

  const mdBody = markdown.newBuilder()
    .headerOrdered(false)
    .text(JSON.stringify(frontMatter))
    .newline();

  mdBody.text(`${oldestPubDate.toUTCString()} ~ ${latestPubDate.toUTCString()}`).newline();

  await (async() => {
    const siteName ='What\'s New with AWS?';
    const siteUrl = 'https://aws.amazon.com/new/';
    const feedUrl = 'https://aws.amazon.com/new/feed/';
    mdBody.h2(`[${siteName}](${siteUrl})`);
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      for await (let item of items) {
        const { title, link, contentSnippet } = item;
        mdBody.h4(`[${title}](${link})`);
        if (lang == 'en') {
          mdBody.blockQuote(contentSnippet!);
        } else {
          const translatedContentSnippet = await translate(contentSnippet!, 'en', lang);
          mdBody.blockQuote(translatedContentSnippet);
        };
      };
    } else {
      mdBody.text('No updates.').newline();
    };
  })();

  mdBody.h2('Blogs');

  for await (let blog of dataSource.jpBlogs) {
    const feedUrl = blog.url + 'feed/';
    const { title: siteTitle, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      if (lang == 'ja') {
        mdBody.h3(`[${siteTitle}](${blog.url})`);
      } else {
        mdBody.h3(`[${blog.name}](${blog.url})`);
      };
      for await (let item of items) {
        let { title, link } = item;
        if (lang != 'ja') { title = await translate(title!, 'ja', lang) };
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  };

  for await (let blog of dataSource.blogs) {
    const feedUrl = blog.url + 'feed/';
    const { title: siteTitle, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${siteTitle}](${blog.url})`);
      for await (let item of items) {
        const { title, link } = item;
        mdBody.text(`1. [${title}](${link})`).newline();
      };
    };
  };

  mdBody.h2('Videos');

  await (async() => {
    const siteTitle ='AWS Black Belt Online Seminar';
    const siteLink = 'https://www.youtube.com/playlist?list=PLzWGOASvSx6FIwIC2X1nObr1KcMCBBlqY';
    const feedUrl = 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLzWGOASvSx6FIwIC2X1nObr1KcMCBBlqY';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      if (lang == 'ja') {
        mdBody.h3(`[${siteTitle}](${siteLink})`);
      } else {
        mdBody.h3(`[${siteTitle} (Japanese)](${siteLink})`);
      };
      for await (let item of items) {
        let { title, link } = item;
        if (lang != 'ja') { title = await translate(title!, 'ja', lang) };
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  })();

  mdBody.h2('Open Source Releases');

  for await (let oss of dataSource.oss) {
    const feedUrl = oss.url + 'releases.atom';
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h3(`[${oss.name}](${oss.url})`);
      for await (let item of items) {
        const { title, link } = item;
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  };

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: contentObjectKey,
    Body: mdBody.toMarkdown(),
  }));

  return { bucket: bucketName, key: contentObjectKey };
};
