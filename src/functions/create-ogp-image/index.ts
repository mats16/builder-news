import fs from 'fs';
//import path from 'path';
import { Readable } from 'stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Handler } from 'aws-lambda';
import { createCanvas, registerFont, loadImage } from 'canvas';
import fetch from 'node-fetch';
import { CreatePostOutputEvent } from '../utils';

const bucketName = process.env.BUCKET_NAME!;

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

const putObject = async (bucket: string, key: string, body: Buffer) => {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body });
  await s3.send(cmd);
  return;
};

const downloadFile = async (url: string, destPath: string) => {
  console.log(`downloading from ${url}...`);
  const res = await fetch(url);
  const fileStream = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    res.body?.pipe(fileStream);
    res.body?.on('error', reject);
    fileStream.on('finish', resolve);
  });
  console.log(`stored to ${destPath}`);
};

const size = { width: 1200, height: 630 };

const generateOgpImage = async (title: string, description: string, pubDateRange: string, lang: string = 'ja'): Promise<Buffer> => {
  // font を登録
  if (lang == 'ja') {
    await downloadFile('https://fonts.gstatic.com/ea/notosansjapanese/v6/NotoSansJP-Bold.otf', '/tmp/NotoSansJP-Bold.otf');
    registerFont('/tmp/NotoSansJP-Bold.otf', { family: 'NotoSansJP' });
  }

  // canvas を作成
  const { width, height } = size;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  // 元になる画像を読み込む
  //const srcImage = await getObject(bucketName, 'hugo/themes/PaperMod/images/tn.png');
  //const image = await loadImage(srcImage);

  // 元の画像を canvas にセットする
  //ctx.drawImage(image, 0, 0, width, height);

  context.fillStyle = '#F2F3F3';
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#EB9D3F';
  context.fillRect(60, 68, 1098, 514);

  context.fillStyle = '#FFFFFF';
  context.fillRect(48, 54, 1098, 514);

  // Title
  context.textBaseline = 'middle';
  context.fillStyle = '#000000';
  if (lang == 'ja') {
    context.font = 'bold 62pt NotoSansJP';
  } else {
    context.font = 'bold 62pt Arial';
  }
  context.fillText(title, 110, 180);

  // Description
  context.fillStyle = '#000000';
  if (lang == 'ja') {
    context.font = 'bold 30pt NotoSansJP';
  } else {
    context.font = 'bold 30pt Arial';
  }
  context.fillText(description, 120, 280);

  // Date Range
  context.fillStyle = '#000000';
  context.font = 'bold 16pt Arial';
  context.fillText(pubDateRange, 120, 500);

  // Site Name
  context.fillStyle = '#000000';
  context.font = 'bold 32pt Arial';
  context.fillText('Builder News', 820, 500);

  return canvas.toBuffer('image/png');
};
export const handler: Handler = async (event, _context) => {
  const payload: CreatePostOutputEvent = event.Payload;
  const { title, description, pubDateRange, thumbnailKey } = payload;
  const thumbnailImage = await generateOgpImage(title, description, pubDateRange);
  await putObject(bucketName, thumbnailKey, thumbnailImage);
};
