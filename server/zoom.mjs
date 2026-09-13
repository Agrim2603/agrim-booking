import { validZoomURL } from './security.mjs';

export class ZoomError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}

export function zoomClient(config, http = fetch) {
  let token = '', expires = 0;
  async function accessToken() {
    if (token && expires > Date.now() + 60000) return token;
    let response;
    try {
      response = await http('https://zoom.us/oauth/token', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'account_credentials', account_id: config.accountId }),
      });
    } catch { throw new ZoomError('Zoom could not be reached. No meeting request was sent.'); }
    if (!response.ok) throw new ZoomError('Zoom authorization failed. Check the server credentials and app activation.');
    let data;
    try { data = await response.json(); } catch { throw new ZoomError('Zoom returned an invalid authorization response.'); }
    if (!data.access_token) throw new ZoomError('Zoom did not return an access token.');
    token = data.access_token;
    expires = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return token;
  }
  return async booking => {
    const bearer = await accessToken();
    let response;
    try {
      response = await http(`https://api.zoom.us/v2/users/${encodeURIComponent(config.hostUserId)}/meetings`, {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'Consultation', type: 2, start_time: booking.start,
          duration: booking.duration, timezone: 'UTC',
          settings: { waiting_room: true, join_before_host: false, approval_type: 2 } }),
      });
    } catch { throw new ZoomError('Zoom may have created the meeting. Check your Zoom account and paste its join link before accepting again.', true); }
    if (!response.ok) throw new ZoomError(`Zoom rejected meeting creation (HTTP ${response.status}). Check your Zoom permissions and account limits.`, response.status >= 500);
    let data;
    try { data = await response.json(); } catch { throw new ZoomError('Check Zoom for the new meeting and paste its join link.', true); }
    if (!data.join_url || !validZoomURL(data.join_url)) throw new ZoomError('Zoom created a meeting but did not return a supported join link. Check your Zoom account.', true);
    // Only the participant join URL is stored; never expose Zoom's privileged start_url.
    return { url: data.join_url, id: String(data.id || '') };
  };
}
