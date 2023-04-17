import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Handler } from 'aws-lambda';
import axios from 'axios';
import { Feed } from 'feed';

/** Loft イベントページの裏の API */
const eventSource = [
  {
    api: 'https://aws-startup-lofts.com/apj/api/session',
    baseUrl: 'https://aws-startup-lofts.com/apj/event/',
  },
  {
    api: 'https://aws-startup-lofts.com/apj/api/externalevent',
    baseUrl: 'https://aws-startup-lofts.com/apj/external-event/',
  },
];

const bucketName = process.env.BUCKET_NAME || 'my-bucket';
const feedKey = process.env.FEED_KEY || 'startup/loft/tokyo/events';

const putObject = async (bucket: string, key: string, body: string) => {
  const client = new S3Client({});
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/rss+xml; charset=UTF-8',
    CacheControl: 'max-age=600',
  });
  await client.send(cmd);
  client.destroy();
};

const createInvalidation = async (distributionId: string, item: string) => {
  const client = new CloudFrontClient({});
  const cmd = new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: Date.now().toString(),
      Paths: {
        Quantity: 1,
        Items: [item],
      },
    },
  });
  await client.send(cmd);
  client.destroy();
};

interface Event {
  createdDate: string;
  description: string;
  tags: string[];
  tier: string;
  presenter: string;
  bookedPlaces: number;
  startWithTimeZone: string;
  settingDetails: any[];
  featured: boolean;
  start: string;
  type: string;
  audienceTypes: string;
  title: string;
  summary: string;
  levels: string[];
  year: number;
  urlSlug: string;
  physicalLoft?: string;
  status: string;
  language: string;
  visibilityDetails: any;
  id: string;
  geoRestrictions: string[];
  endWithTimeZone: string;
  sponsors: string[];
  modifiedDate: string;
  end: string;
  startDate: string;
  timeZone: string;
  crossMarketingDetails: any;
  tierDetails: any;
};

export const handler: Handler = async () => {
  const feed = new Feed({
    title: 'Events at AWS Startup Loft Tokyo',
    //description: 'Events at AWS Startup Loft Tokyo',
    id: 'https://www.daily-aws.com/startup/loft/tokyo/events',
    link: 'https://aws-startup-lofts.com/apj/loft/tokyo/events',
    language: 'ja',
    copyright: 'N/A',
  });

  await Promise.all(eventSource.map(async src => {
    const { data } = await axios.get(src.api);
    const futureEvents: Event[] = data.future;
    futureEvents.map(event => {
      // アクティブで Loft Tokyo のページに掲載があるものだけ取得
      if (event.status == 'live' && event.physicalLoft == 'tokyo-loft') {
        feed.items.push({
          title: `[${event.startDate}] ${event.title}`,
          description: event.summary,
          link: src.baseUrl + event.id,
          date: new Date(event.createdDate),
          //category: event.tags.map(tag => {
          //  return { term: tag };
          //}),
          author: [{ name: event.presenter }],
        });
      }
    });
  }));

  await putObject(bucketName, feedKey, feed.rss2());

  await createInvalidation(process.env.DISTRIBUTION_ID!, `/${feedKey}`);

  return;
};
