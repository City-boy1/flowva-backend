/**
 * get-youtube-refresh-token.cjs
 *
 * Run this ONCE, locally, signed into the Google account that owns/manages
 * your client's YouTube channel (not necessarily your own Google account —
 * whoever should be the uploader).
 *
 * Run from your backend project root, since it reuses the googleapis
 * package already in your node_modules:
 *
 *   node get-youtube-refresh-token.cjs
 *
 * It prints a URL. Paste that URL into your browser, log in, approve
 * access, and Google will redirect you to a localhost:3000 page that
 * fails to load (that's expected — nothing is running there to catch it
 * visually). Look at your TERMINAL instead: the code Google put in that
 * failed URL's address bar needs to be pasted back in when prompted.
 *
 * Uses YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REDIRECT_URI
 * from your .env — make sure you've added those first (see chat message).
 */

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI,
);

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // required to get a refresh_token
  prompt: 'consent',      // forces refresh_token even if you've authorized before
  scope: SCOPES,
});

console.log('\nOpen this URL in your browser, log in, and approve access:\n');
console.log(authUrl);
console.log('\nAfter approving, the browser will redirect to a page that');
console.log('fails to load. Copy the "code=" value from that page\'s URL');
console.log('(everything between "code=" and the next "&"), and paste it below.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Paste the code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n=== SAVE THIS TO YOUR .env ===');
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('================================\n');

    if (!tokens.refresh_token) {
      console.log(
        'No refresh_token was returned. This usually means this Google ' +
          'account already granted consent before. Go to ' +
          'https://myaccount.google.com/permissions, remove access for ' +
          'this app, then run this script again.',
      );
    }
  } catch (err) {
    console.error('Token exchange failed:', err.message);
  }
});
