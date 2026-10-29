// Fork (AutonomousBusinessUnits/postiz): Uppy uploader that sends each file
// straight from the browser to Vercel Blob with a client token minted by the
// backend (/media/blob-upload), then records it (/media/blob-complete).
// The bytes never pass through a Function, so the 4.5 MB body limit is moot.
import { BasePlugin } from '@uppy/core';
import { upload } from '@vercel/blob/client';

export class VercelBlobUploader extends BasePlugin<any, any, any> {
  constructor(uppy: any, opts: { fetch: any; backendUrl: string }) {
    super(uppy, opts);
    this.id = 'VercelBlobUploader';
    this.type = 'uploader';
  }

  install() {
    this.uppy.addUploader(this.uploadFiles);
  }

  uninstall() {
    this.uppy.removeUploader(this.uploadFiles);
  }

  uploadFiles = async (fileIDs: string[]) => {
    await Promise.all(fileIDs.map((id) => this.uploadOne(id)));
  };

  uploadOne = async (id: string) => {
    const file: any = this.uppy.getFile(id);
    if (!file) return;
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    try {
      this.uppy.emit('upload-progress', file, {
        uploadStarted: Date.now(),
        bytesUploaded: 0,
        bytesTotal: file.size,
      });
      const blob = await upload(`uploads/${Date.now()}.${ext}`, file.data, {
        access: 'public',
        contentType: file.type,
        handleUploadUrl: `${this.opts.backendUrl}/media/blob-upload`,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ loaded, total }) => {
          const current = this.uppy.getFile(id);
          if (!current) return;
          this.uppy.emit('upload-progress', current, {
            uploadStarted: current.progress?.uploadStarted || Date.now(),
            bytesUploaded: loaded,
            bytesTotal: total,
          });
        },
      });
      const res = await this.opts.fetch('/media/blob-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: blob.url, originalName: file.name }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => 'save failed'));
      const body = await res.json();
      this.uppy.emit('upload-success', this.uppy.getFile(id), {
        status: 200,
        body,
        uploadURL: blob.url,
      });
    } catch (err: any) {
      this.uppy.emit('upload-error', this.uppy.getFile(id), err);
    }
  };
}
