import { createServer } from 'http';
import { URL } from 'url';
import open from 'open';

const CLIENT_ID     = '916154482371-l9emn8bs0kjq5dgjse0g7iu7sh1ugrba.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI  = 'http://localhost:5000/auth/youtube/callback';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube')}` +
  `&access_type=offline` +
  `&prompt=consent`;

const server = createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost:5000');
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code'); return; }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();
  res.end('Done! Check your terminal.');
  console.log('\n✅ PASTE THIS IN YOUR .env:\n');
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
  server.close();
});

server.listen(5000, () => {
  console.log('Opening browser...');
  open(authUrl);
});