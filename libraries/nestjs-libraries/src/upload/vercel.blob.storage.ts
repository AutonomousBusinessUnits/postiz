// Fork (AutonomousBusinessUnits/postiz): Vercel Blob storage provider.
// STORAGE_PROVIDER=vercel-blob, BLOB_READ_WRITE_TOKEN from the connected store.
// Server-side writes (generated images, URL imports) go through put(); browser
// uploads go straight to Blob with a client token (see media.controller.ts
// /media/blob-upload), so they never cross the 4.5 MB Function body limit.
import { put, del } from '@vercel/blob';
import { Readable } from 'stream';
import 'multer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { IUploadProvider, UploadedStream } from './upload.interface';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

export const BLOB_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
];
const ALLOWED = new Set(BLOB_ALLOWED_MIME_TYPES);

export const blobKey = (ext: string) => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, '/');
  return `uploads/${day}/${makeId(32)}.${ext}`;
};

export class VercelBlobStorage implements IUploadProvider {
  private async putBuffer(body: Buffer, mime: string, ext: string) {
    const blob = await put(blobKey(ext), body, {
      access: 'public',
      contentType: mime,
    });
    return blob.url;
  }

  async uploadSimple(path: string) {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;
    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(path))) {
        throw new Error('Unsafe URL');
      }
      const res = await fetch(path, {
        // @ts-ignore undici option
        dispatcher: ssrfSafeDispatcher,
      });
      body = Buffer.from(await res.arrayBuffer());
    }
    const detected = await fileTypeFromBuffer(body);
    if (!detected || !ALLOWED.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    return this.putBuffer(body, detected.mime, detected.ext);
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const url = await this.putBuffer(file.buffer, detected.mime, detected.ext);
    const filename = url.split('/').pop()!;
    return {
      filename,
      mimetype: detected.mime,
      size: file.size,
      buffer: file.buffer,
      originalname: filename,
      fieldname: 'file',
      path: url,
      destination: url,
      encoding: '7bit',
      stream: file.buffer as any,
    };
  }

  async uploadStream(
    stream: Readable,
    mimetype: string,
    ext: string
  ): Promise<UploadedStream> {
    if (!ALLOWED.has(mimetype)) {
      stream.resume();
      throw new Error('Unsupported file type.');
    }
    const blob = await put(blobKey(ext), stream, {
      access: 'public',
      contentType: mimetype,
      multipart: true,
    });
    const filename = blob.url.split('/').pop()!;
    return { filename, originalname: filename, path: blob.url, mimetype };
  }

  async removeFile(filePath: string): Promise<void> {
    if (!filePath?.startsWith('https://')) return;
    await del(filePath).catch(() => undefined);
  }

  publicUrl(fileName: string) {
    return fileName;
  }
}
