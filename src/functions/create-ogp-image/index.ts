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

const generateOgpImage = async (title: string, description: string): Promise<Buffer> => {
  // font を登録
  await downloadFile('https://fonts.gstatic.com/ea/notosansjapanese/v6/NotoSansJP-Bold.otf', '/tmp/NotoSansJP-Bold.otf');
  registerFont('/tmp/NotoSansJP-Bold.otf', { family: 'NotoSansJP' });

  // canvas を作成
  const { width, height } = size;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  // 元になる画像を読み込む
  //const srcImage = await getObject(bucketName, 'hugo/themes/PaperMod/images/tn.png');
  //const image = await loadImage(srcImage);

  // 元の画像を canvas にセットする
  //ctx.drawImage(image, 0, 0, width, height);

  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);

  context.textAlign = 'center';
  context.fillStyle = '#000000';
  context.font = 'bold 70pt NotoSansJP';
  context.fillText(title, 600, 300);

  //description
  context.textAlign = 'center';
  context.fillStyle = '#000000';
  context.font = 'bold 25pt NotoSansJP';
  context.fillText(description, 600, 400);

  // Header
  context.textBaseline = 'top';
  context.fillStyle = '#000000';
  context.font = 'bold 30pt NotoSansJP';
  context.fillText('Builder News', 200, 70);

  // Footer
  context.fillStyle = '#000000';
  context.font = 'bold 30pt NotoSansJP';
  context.fillText('news.wktk.dev', 600, 530);

  return canvas.toBuffer('image/png');
};
export const handler: Handler = async (event, _context) => {
  const payload: CreatePostOutputEvent = event.Payload;
  const { title, description, coverImageKey } = payload;
  const ogpImage = await generateOgpImage(title, description);
  await putObject(bucketName, coverImageKey, ogpImage);
};
