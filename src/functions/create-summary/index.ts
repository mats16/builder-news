import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { ScheduledHandler, ScheduledEvent, Context } from 'aws-lambda';
import markdown from 'markdown-doc-builder';
import Parser from 'rss-parser';

const logger = new Logger();
const metrics = new Metrics();
const tracer = new Tracer();

const parser = new Parser();

const rssUrl = process.env.RSS_URL!;
const bucketName = process.env.BUCKET_NAME!;

const s3 = new S3Client({});
const translate = new TranslateClient({});

//const generateSummary = (items: Parser.Item[], langCode?: string) => {
//  const markdownContent = markdown.newBuilder()
//    .text('+++\n')
//    .text(`date = "${latestPubDate.toISOString()}"\n`)
//    .text('menu = "main"\n')
//    .text(`title = "${summaryDateString}"\n`)
//    .text('+++\n');
//};

class Lambda implements LambdaInterface {

  @metrics.logMetrics()
  @tracer.captureLambdaHandler()
  public async handler(event: ScheduledEvent, _context: Context): Promise<void> {
    const { time } = event; // 2022-04-14T12:10:00Z
    const scheduledTime = new Date(time);

    const latestPubDate = scheduledTime;
    const oldestPubDate = (latestPubDate.getDay() == 0)
      ? new Date(latestPubDate.valueOf() - 3*60*60*24*1000)
      : new Date(latestPubDate.valueOf() - 60*60*24*1000);

    const feed = await parser.parseURL(rssUrl);
    const newItems = feed.items.filter((item) => {
      const pubDate = new Date(item.pubDate!);
      return (pubDate > oldestPubDate && pubDate <= latestPubDate);
    });
    const sortedNewItems = newItems.sort((item) => {
      const pubDate = new Date(item.pubDate!);
      return pubDate.valueOf();
    });

    const summaryDate = new Date(scheduledTime.valueOf() + 60*60*1000);
    const summaryDateString = summaryDate.toISOString().split('T')[0];

    const markdownContent = markdown.newBuilder()
      .text('+++\n')
      .text(`date = "${latestPubDate.toISOString()}"\n`)
      .text('menu = "main"\n')
      .text(`title = "${summaryDateString}"\n`)
      .text('+++\n');

    for await (let item of sortedNewItems) {
      const contentSnippet = item.contentSnippet;
      const translateTextCommand = new TranslateTextCommand({
        Text: contentSnippet,
        SourceLanguageCode: 'en',
        TargetLanguageCode: 'ja',
      });
      const { TranslatedText } = await translate.send(translateTextCommand);
      markdownContent.h3(`[${item.title}](${item.link})`);
      markdownContent.blockQuote(TranslatedText!);
    };

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `content/posts/${summaryDateString}.md`,
      Body: markdownContent.toMarkdown(),
    }));

    return;
  };

};

export const myFunction = new Lambda();
export const handler: ScheduledHandler = myFunction.handler;