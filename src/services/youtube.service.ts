/**
 * youtube.service.ts
 *
 * Place this file in the SAME FOLDER as tutorial.service.ts — it's
 * imported there as `./youtube.service.js`.
 *
 * Flow this matches (as already written in tutorial.service.ts):
 *   1. tutorialService.create() uploads the video immediately as PRIVATE
 *      on YouTube, tutorial status = 'PENDING' in your DB.
 *   2. Admin reviews. approve() -> setPublic(). reject()/unpublish() -> setPrivate().
 *   3. permanentDelete() -> deleteVideo(), only allowed once status is REJECTED.
 *
 * Required env vars (add to .env, see chat message for exact lines):
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REDIRECT_URI
 *   YOUTUBE_REFRESH_TOKEN   <- obtained by running get-youtube-refresh-token.cjs once
 *
 * NOTE on private videos: a 'private' YouTube video is only viewable by
 * the channel owner's Google account (and anyone explicitly invited).
 * If your admin dashboard needs to preview a PENDING tutorial's video
 * before approving it, that preview has to happen through YouTube Studio
 * itself (logged in as the client's channel), or you embed it differently —
 * a private video's watch page will not play for a random visitor even
 * with the link. Flag this to your client if dashboard preview is expected.
 */

import { google } from 'googleapis';
import fs from 'fs';

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI,
);

oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: 'v3',
  auth: oauth2Client,
});

interface UploadResult {
  youtubeId: string;
  youtubeUrl: string;
  thumbnailUrl: string;
}

export const youtubeService = {
  async uploadVideo(
    filePath: string,
    title: string,
    description: string,
    tags: string[],
  ): Promise<UploadResult> {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
        },
        status: {
          privacyStatus: 'private', // gated until admin approves
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    const youtubeId = res.data.id;
    if (!youtubeId) {
      throw new Error('YouTube upload succeeded but returned no video id.');
    }

    const thumbnails = res.data.snippet?.thumbnails;
    const thumbnailUrl =
      thumbnails?.high?.url ??
      thumbnails?.medium?.url ??
      thumbnails?.default?.url ??
      '';

    return {
      youtubeId,
      youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      thumbnailUrl,
    };
  },

  async setPublic(youtubeId: string): Promise<void> {
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: youtubeId,
        status: {
          privacyStatus: 'public',
        },
      },
    });
  },

  async setPrivate(youtubeId: string): Promise<void> {
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: youtubeId,
        status: {
          privacyStatus: 'private',
        },
      },
    });
  },

  async deleteVideo(youtubeId: string): Promise<void> {
    await youtube.videos.delete({
      id: youtubeId,
    });
  },
};