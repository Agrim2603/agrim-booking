# Optional automatic Zoom meetings

Manual mode works without any credentials: create a meeting in Zoom, paste its participant join URL in the dashboard, and accept the booking. The client sees it on the private confirmation page.

## Connect your own Zoom account

1. In the Zoom App Marketplace, create a **Server-to-Server OAuth** app for the account that will host consultations. Account administrator permission may be required.
2. Add the meeting creation permission for the intended host user/account. Consult Zoom’s current **Create a meeting** API documentation for the applicable scope; available permissions depend on your app/account configuration.
3. Activate the app.
4. Add these values to your hosting environment (or local ignored `.env`):

| Variable | Value |
|---|---|
| `ZOOM_ACCOUNT_ID` | The app’s account ID |
| `ZOOM_CLIENT_ID` | The app’s client ID |
| `ZOOM_CLIENT_SECRET` | The app’s client secret |
| `ZOOM_HOST_USER_ID` | The host’s Zoom user ID or account email |

Set all four values together and restart/redeploy. Never put them in `public/`, GitHub source, client JavaScript or chat messages.

## What happens on acceptance

When you accept a pending request without an existing Zoom URL, the server obtains an account OAuth token, creates a scheduled meeting at the booked UTC time, and saves the participant join link. Private notes and the client’s discussion topic are not sent to Zoom. Waiting-room behavior is requested, subject to your account policies. Meeting length remains subject to your Zoom plan’s limits.

The client’s confirmation page updates to show the link. No email is automatically sent; use **Email meeting details** if you also want to send it yourself.

If Zoom fails before creation, the booking remains pending. If the outcome is uncertain (such as a network timeout after sending the request), the app requires you to check Zoom and paste the existing join link before trying to accept again. This avoids blindly creating duplicate meetings. A server interruption can leave a booking marked “Preparing Zoom”; inspect Zoom and add its join link to complete acceptance.

If you decline/cancel an accepted booking, cancel any existing Zoom meeting in Zoom as well. The app does not delete Zoom meetings.

## Verification

Integration tests use a fake Zoom API and never contact your account. After configuring credentials, create one test booking, accept it, verify the meeting in your Zoom account, and check the client’s join link. Remove/cancel that test meeting when done.

Official references:

- [Server-to-server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/)
- [Meetings API: Create a meeting](https://developers.zoom.us/docs/api/meetings/#tag/meetings/POST/users/{userId}/meetings)
