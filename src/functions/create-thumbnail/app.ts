import { Readable } from 'stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Handler } from 'aws-lambda';
import { createCanvas, registerFont, loadImage } from 'canvas';

export interface CreateThumbnailInputPayload {
  lang: string;
  title: string;
  description: string;
  pubDateRange: string;
  urlPath: string;
};

const hugoContentBucketName = process.env.HUGO_CONTENT_BUCKET_NAME!;
const hugoContentBucketPath = process.env.HUGO_CONTENT_BUCKET_PATH || 'content';

const s3 = new S3Client({});

const asBuffer = async (data: unknown): Promise<Buffer> => {
  const stream = data as Readable;
  const chunks: Buffer[] = [];
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  return buffer;
};

const getObject = async (bucket: string, key: string): Promise<Buffer> => {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const { Body } = await s3.send(cmd);
  const buffer = await asBuffer(Body);
  return buffer;
};

const putObject = async (bucket: string, key: string, body: Buffer, contentType: string = 'image/png') => {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3.send(cmd);
  return;
};

const size = { width: 1200, height: 630 };

const genThumbnailImage = async (title: string, description: string, pubDateRange: string, lang: string): Promise<Buffer> => {
  // font を登録
  registerFont('/etc/fonts/NotoSansJP-Bold.otf', { family: 'NotoSansJP' });

  // canvas を作成
  const { width, height } = size;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  context.fillStyle = '#F2F3F3';
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#EB9D3F';
  context.fillRect(60, 68, 1098, 514);

  context.fillStyle = '#FFFFFF';
  context.fillRect(48, 54, 1098, 514);

  // Icon
  const cloudIcon = await getObject(hugoContentBucketName, 'hugo/static/img/cloud-100.png');
  await loadImage(cloudIcon).then(image => {
    context.drawImage(image, 1000, 440, 100, 100);
  });

  // Title
  context.textBaseline = 'middle';
  context.fillStyle = '#000000';
  context.font = (lang == 'ja') ? 'bold 62pt NotoSansJP' : 'bold 62pt Arial';
  context.fillText(title, 110, 180);

  // Description
  context.fillStyle = '#000000';
  context.font = (lang == 'ja') ? 'bold 30pt NotoSansJP' : 'bold 30pt Arial';
  context.fillText(description, 120, 280);

  // Date Range
  context.fillStyle = '#000000';
  context.font = (lang == 'ja') ? 'bold 20pt NotoSansJP' : 'bold 18pt Arial';
  context.fillText(pubDateRange, 120, 500);

  // Site Name
  //context.fillStyle = '#000000';
  //context.font = 'bold 32pt Arial';
  //context.fillText('Builder News', 820, 500);

  return canvas.toBuffer('image/png');
};
export const handler: Handler = async (event, _context) => {
  const payload: CreateThumbnailInputPayload = event.Payload;
  const { title, description, pubDateRange, urlPath, lang } = payload;
  const thumbnailImage = await genThumbnailImage(title, description, pubDateRange, lang);
  const objectKey = `${hugoContentBucketPath}/${urlPath}/thumbnail.${lang}.png`;
  await putObject(hugoContentBucketName, objectKey, thumbnailImage);
};
