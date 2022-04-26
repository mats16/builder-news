//import { Logger } from '@aws-lambda-powertools/logger';
//import { Metrics } from '@aws-lambda-powertools/metrics';
//import { Tracer } from '@aws-lambda-powertools/tracer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { Handler } from 'aws-lambda';
import markdown from 'markdown-doc-builder';
import Parser from 'rss-parser';
import { CreatePostOutputEvent } from '../utils';
import { source } from './config';

const bucketName = process.env.BUCKET_NAME!;
const hugoContentBucketPath = 'hugo/content';

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
  const lang = event.lang || 'ja';
  const time: string|undefined = event.input?.time; // 2022-04-14T12:10:00Z
  const isDraft: boolean = (typeof event.input?.isDraft == 'boolean') ? event.input?.isDraft : true;

  const executedDate = (typeof time == 'string')
    ? new Date(time)
    : new Date();

  const latestPubDate = new Date(executedDate);
  if (latestPubDate.getHours() != 0 || latestPubDate.getMinutes() != 0) {
    latestPubDate.setHours(0, 0, 0, 0);
    latestPubDate.setDate(latestPubDate.getDate() + 1);
  }
  const oldestPubDate = new Date(latestPubDate);
  oldestPubDate.setDate(oldestPubDate.getDate() - 1);

  switch (latestPubDate.getDay()) {
    case 6:
      latestPubDate.setDate(latestPubDate.getDate() + 2);
      break;
    case 0:
      latestPubDate.setDate(latestPubDate.getDate() + 1);
      oldestPubDate.setDate(oldestPubDate.getDate() - 1);
      break;
    case 1:
      oldestPubDate.setDate(oldestPubDate.getDate() - 2);
      break;
    default:
      break;
  };

  const postDateString = oldestPubDate.toISOString().split('T')[0];
  const postTitle = (lang == 'ja')
    ? `日刊AWS ${postDateString}`
    : `Daily AWS ${postDateString}`;
  const postDescription = (lang == 'ja')
    ? 'AWS関連のニュースヘッドライン'
    : 'AWS News Headlines';
  const postUrlPath = `posts/daily-aws-${postDateString.replace(/-/g, '')}`;
  const postBucketPath = `${hugoContentBucketPath}/${postUrlPath}`;
  const postKey = `${postBucketPath}/index.${lang}.md`;
  const thumbnailKey = `${postBucketPath}/thumbnail.${lang}.png`;

  // https://gohugo.io/content-management/front-matter/
  const frontMatter = {
    draft: isDraft,
    isCJKLanguage: (lang == 'ja') ? true : false,
    title: postTitle,
    description: postDescription,
    date: latestPubDate.toISOString(),
    //lastmod: executedDate.toISOString(),
    categories: ['news'],
    series: ['daily-aws'],
    tags: ['aws'],
    thumbnail: `posts/daily-aws-${postDateString}/thumbnail.${lang}.png`,
  };

  const mdBody = markdown.newBuilder()
    .headerOrdered(false)
    .text(JSON.stringify(frontMatter))
    .newline();

  const pubDateRange = (lang == 'ja')
    ? `${oldestPubDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} ~ ${latestPubDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (JST)`
    : `${oldestPubDate.toLocaleString('en-US', { timeZone: 'UCT' })} ~ ${latestPubDate.toLocaleString('en-US', { timeZone: 'UTC' })} (UTC)`;

  mdBody.text(pubDateRange).newline();

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
  for await (let playlist of source.youtube.playlists) {
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

  for await (let blog of source.awsJapanBlogs) {
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

  for await (let blog of source.awsBlogs) {
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
  for await (let repo of source.githubRepos) {
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
    Key: postKey,
    Body: mdBody.toMarkdown(),
  }));

  const payload: CreatePostOutputEvent = {
    lang,
    title: postTitle,
    description: postDescription,
    pubDateRange,
    bucket: bucketName,
    key: postKey,
    thumbnailKey,
  };

  return payload;
};
