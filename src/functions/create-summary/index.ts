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
  youtube: {
    playlists: [
      {
        id: 'PLzWGOASvSx6FIwIC2X1nObr1KcMCBBlqY',
        name: {
          ja: 'AWS Black Belt Online Seminar (日本語)',
          en: 'AWS Black Belt Online Seminar (Japanese)',
        } }
    ]
  },
  awsJapanBlogs: [
    {
      category: 'news',
      name: {
        ja: 'Amazon Web Services ブログ (日本語)',
        en: 'AWS Japan Blog (Japanese)',
      },
    },
    {
      category: 'startup',
      name: {
        ja: 'AWS Startup ブログ (日本語)',
        en: 'AWS Japan Startup Blog (Japanese)',
      },
    },
  ],
  awsBlogs: [
    { category: 'aws' }, // AWS News Blog
    { category: 'startups' },
    { category: 'opensource' },
    { category: 'architecture' },
    { category: 'aws-cloud-financial-management' },
    { category: 'mt' }, // AWS Cloud Operations & Migrations Blog
    //{ category: 'apn' }, // AWS Partner Network (APN) Blog
    //{ category: 'awsmarketplace' },
    { category: 'big-data' },
    { category: 'business-productivity' },
    { category: 'compute' },
    { category: 'contact-center' },
    { category: 'containers' },
    { category: 'database' },
    { category: 'desktop-and-application-streaming' },
    { category: 'developer' }, // AWS Developer Tools Blog
    { category: 'devops' },
    //{ category: 'enterprise-strategy' },
    { category: 'mobile' }, // Front-End Web & Mobile
    //{ category: 'gametech' },
    { category: 'hpc' },
    { category: 'infrastructure-and-automation' },
    { category: 'industries' },
    { category: 'iot' },
    { category: 'machine-learning' },
    { category: 'media' },
    { category: 'messaging-and-targeting' },
    { category: 'networking-and-content-delivery' },
    //{ category: 'publicsector' },
    { category: 'quantum-computing' },
    { category: 'robotics' },
    //{ category: 'awsforsap' }, // SAP
    { category: 'security' },
    { category: 'storage' },
    //{ category: 'training-and-certification' },
    //{ category: 'modernizing-with-aws' }, // Windows on AWS
  ],
  githubRepos: [
    { title: 'AWS CDK', name: 'aws/aws-cdk' },
    //{ title: 'AWS Amplify CLI', name: 'aws-amplify/amplify-cli' },
    { title: 'Amplify for JavaScript', name: 'aws-amplify/amplify-js' },
    { title: 'Amplify for iOS', name: 'aws-amplify/amplify-ios' },
    { title: 'Amplify for Android', name: 'aws-amplify/amplify-android' },
    { title: 'Amplify for Flutter', name: 'aws-amplify/amplify-flutter' },
    { title: 'Amplify UI', name: 'aws-amplify/amplify-ui' },
    { title: 'OpenSearch', name: 'opensearch-project/OpenSearch' },
    { title: 'Amazon Chime SDK for JavaScript', name: 'aws/amazon-chime-sdk-js' },
    { title: 'AWS Copilot CLI', name: 'aws/copilot-cli' },
    { title: 'Firecracker', name: 'firecracker-microvm/firecracker' },
    { title: 'Bottlerocket OS', name: 'bottlerocket-os/bottlerocket' },
    { title: 'AWS Load Balancer Controller', name: 'kubernetes-sigs/aws-load-balancer-controller' },
    { title: 'Karpenter', name: 'aws/karpenter' },
    { title: 'Amazon EKS Anywhere', name: 'aws/eks-anywhere' },
  ],
};

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
  const lang = event.lang || 'ja';
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
  const contentTitle = (lang == 'ja')
    ? `日刊AWS ${contentDateString}`
    : `Daily AWS ${contentDateString}`;
  const contentdescription = (lang == 'ja')
    ? 'AWS関連のニュースヘッドライン'
    : 'AWS News Headlines';
  const contentObjectKey = `hugo/content/posts/daily-aws-${contentDateString}.${lang}.md`;

  // https://gohugo.io/content-management/front-matter/
  const frontMatter = {
    title: contentTitle,
    description: contentdescription,
    date: contentDateString,
    lastmod: executedDate.toISOString(),
    categories: [
      'aws',
    ],
  };

  const mdBody = markdown.newBuilder()
    .headerOrdered(false)
    .text(JSON.stringify(frontMatter))
    .newline();

  mdBody.text(`${oldestPubDate.toUTCString()} ~ ${latestPubDate.toUTCString()}`).newline();

  await (async() => {
    const siteTitle = (lang == 'ja') ? '最近の発表' : 'Recent Announcements';
    //const siteUrl = 'https://aws.amazon.com/new/';
    const feedUrl = 'https://aws.amazon.com/new/feed/';
    mdBody.h3(siteTitle);
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      for await (let item of items) {
        const { title, link, contentSnippet } = item;
        mdBody.bold(`[${title}](${link})`).newline();
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

  let hasVideoHeader = false;
  for await (let playlist of dataSource.youtube.playlists) {
    const siteTitle = (lang == 'ja') ? playlist.name.ja : playlist.name.en;
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist.id}`;
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      if (!hasVideoHeader) {
        mdBody.h3('Video');
        hasVideoHeader = true;
      };
      mdBody.h4(siteTitle);
      for await (let item of items) {
        let { title, link } = item;
        if (lang != 'ja') { title = await translate(title!, 'ja', lang); };
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  };

  mdBody.h3('AWS Blogs');

  for await (let blog of dataSource.awsJapanBlogs) {
    const siteTitle = (lang == 'ja') ? blog.name.ja : blog.name.en;
    const feedUrl = `https://aws.amazon.com/jp/blogs/${blog.category}/feed/`;
    const { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h4(siteTitle!);
      for await (let item of items) {
        const { link } = item;
        const title = (lang == 'ja') ? item.title : await translate(item.title!, 'ja', lang);
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  };

  for await (let blog of dataSource.awsBlogs) {
    const feedUrl = `https://aws.amazon.com/blogs/${blog.category}/feed/`;
    const { title: siteTitle, items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    if (items.length > 0) {
      mdBody.h4(siteTitle!);
      for await (let item of items) {
        const { link } = item;
        const title = (lang == 'en') ? item.title : await translate(item.title!, 'en', lang);
        mdBody.text(`- [${title}](${link})`).newline();
      };
    };
  };

  let hasOssHeader = false;
  for await (let repo of dataSource.githubRepos) {
    const repoUrl = `https://github.com/${repo.name}/`;
    const feedUrl = `https://github.com/${repo.name}/releases.atom`;
    let { items } = await getFeed(feedUrl, oldestPubDate, latestPubDate);
    items = items.filter(item => !item.title?.includes('unstable'));
    if (items.length > 0) {
      if (!hasOssHeader) {
        mdBody.h3('Open Source Project');
        hasOssHeader = true;
      };
      mdBody.h4(`[${repo.title}](${repoUrl})`);
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
