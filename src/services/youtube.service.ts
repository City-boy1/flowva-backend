import { google } from 'googleapis';
import fs from 'fs';
import { AppError } from '../middleware/errorHandler.js';

function getClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI,
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  });
  return oauth2Client;
}

export const youtubeService = {

  async uploadVideo(filePath: string, title: string, description: string, tags: string[] = []): Promise<{
    youtubeId: string;
    youtubeUrl: string;
    thumbnailUrl: string;
  }> {
    if (!process.env.YOUTUBE_REFRESH_TOKEN) {
      throw new AppError('YouTube is not configured yet', 503);
    }

    const auth    = getClient();
    const youtube = google.youtube({ version: 'v3', auth });

    const fileSize = fs.statSync(filePath).size;
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title:       title.slice(0, 100),
          description: description || '',
          tags,
          categoryId:  '27', // Education
        },
        status: {
          privacyStatus: 'unlisted', // unlisted until admin approves
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    }, {
      onUploadProgress: (evt: any) => {
        const pct = Math.round((evt.bytesRead / fileSize) * 100);
        process.stdout.write(`\rYouTube upload: ${pct}%`);
      },
    });

    const videoId = res.data.id!;
    return {
      youtubeId:    videoId,
      youtubeUrl:   `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  },

  async deleteVideo(youtubeId: string): Promise<void> {
    if (!process.env.YOUTUBE_REFRESH_TOKEN || !youtubeId) return;
    try {
      const auth    = getClient();
      const youtube = google.youtube({ version: 'v3', auth });
      await youtube.videos.delete({ id: youtubeId });
    } catch (err) {
      // Log but don't throw — DB cleanup should still proceed
      console.error('[YouTube] Delete failed:', err);
    }
  },

  async setPublic(youtubeId: string): Promise<void> {
    if (!process.env.YOUTUBE_REFRESH_TOKEN || !youtubeId) return;
    const auth    = getClient();
    const youtube = google.youtube({ version: 'v3', auth });
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id:     youtubeId,
        status: { privacyStatus: 'public' },
      },
    });
  },

  async setPrivate(youtubeId: string): Promise<void> {
    if (!process.env.YOUTUBE_REFRESH_TOKEN || !youtubeId) return;
    const auth    = getClient();
    const youtube = google.youtube({ version: 'v3', auth });
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id:     youtubeId,
        status: { privacyStatus: 'private' },
      },
    });
  },
};