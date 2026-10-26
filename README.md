# Prayas Chat — Stage 1 + Stage 2 (core)

Black and deep-purple messaging app. Plain HTML/CSS/JS (no build step), Firebase backend, installable as a PWA on Android.
Files are flat (no folders) so you can upload them from a phone.

## Status (honest)

**Built and tested against an in-memory Firebase stand-in (browser automation, 29 checks pass):**
register, email-verification gate, login/logout, password reset request, profile setup with unique username,
profile edit, user search by username, contacts, invite link, private chat (realtime, timestamps,
sent and read ticks, unread counters, chat search, older-message paging), dark/light/system theme,
account deletion, honest "not available yet" screens for Calls and Groups.

**NOT yet tested:** against a real Firebase project, `firestore.rules` in the Firebase emulator, on a real
low-end Android phone. Treat the first run on your Firebase project as the real test, and use the checklist below.

**Not built yet (needs later stages / external services):**
mobile-number OTP, profile photo (needs Firebase Storage, which now needs the paid Blaze plan), "delivered" tick,
typing/online/last-seen, reply/forward/edit/delete messages, voice/image/video/file sharing (Stage 3),
groups, push notifications, block/report (Stage 4), audio/video calls with signaling + TURN (Stage 5),
admin panel, privacy policy / terms pages, sign-out-from-all-devices, rate limiting, APK (Stage 6).
No end-to-end encryption: messages are stored readable in Firestore. Do not claim otherwise.

## Setup

1. **Firebase project**: console.firebase.google.com > Add project (Analytics not needed).
2. **Auth**: Build > Authentication > Get started > enable **Email/Password**.
3. **Firestore**: Build > Firestore Database > Create database (production mode, pick a region near your users).
   Open the **Rules** tab, paste the whole content of `firestore.rules`, press **Publish**.
4. **Web app config**: Project settings > Your apps > add **Web** app > copy `firebaseConfig`.
   Paste the values into `firebase-config.js`. (These are public identifiers, not secrets.)
5. **Host the files over HTTPS** (needed for install + sign-in). Easiest from a phone:
   - GitHub: make a repo, "Add file > Upload files", select all files in this folder, commit.
     Settings > Pages > deploy from branch `main` / root. Your URL is `https://<name>.github.io/<repo>/`.
   - or Netlify Drop / Cloudflare Pages (upload the zip from a computer).
6. **Authorize the domain**: Authentication > Settings > Authorized domains > add your host (e.g. `<name>.github.io`).
7. Open the URL in Chrome on Android. Menu > **Install app** / **Add to Home screen**.

## Environment variables

None. All config is `firebase-config.js` (public web config). Never put service-account keys, admin SDK keys
or any private key in these files. Anything privileged (admin, moderation, push sending) must run on a server later.

## Data model

- `users/{uid}`: displayName, username, bio, createdAt
- `usernames/{username}`: uid (reserves the unique username; created in the same write as the profile)
- `users/{uid}/contacts/{otherUid}`: addedAt
- `chats/{uidA_uidB}` (IDs sorted): members, lastMessage, lastMessageAt, unread{uid: count}
- `chats/{chatId}/messages/{id}`: senderId, text (max 2000), createdAt, read

## Known limits of the current security model

- Any signed-in, verified user can read profiles (needed for username search). A bot could enumerate them.
- `unread` counters are written by clients, so a malicious client could set a wrong counter on its own chats.
  Only a server function (Cloud Functions, Blaze plan) can fully fix this.
- No rate limiting or spam control yet (needs server-side checks / App Check).
- Messages sent while offline are queued in memory only; they are lost if the app is closed before reconnecting.
- Deleting an account removes login, profile, username and contacts. Messages already sent stay in the other person's chat.

## Testing checklist (do this on your Firebase project)

1. Register with a real email, confirm the verification email arrives (check spam), tap the link, then "I have verified".
2. Create profile; try an already-taken username on a second account (must be refused).
3. With two accounts on two phones: search each other, add contact, send messages both ways.
4. Check ticks: one tick after send, two ticks after the other person opens the chat. Check unread badge on the list.
5. Turn on airplane mode, send, turn it off while the app stays open: message must arrive.
6. In Firebase console > Firestore, confirm a third account cannot read chats of the first two (try via Rules Playground).
7. Delete an account and confirm its username can be reused.
8. Test on your lowest-RAM phone: startup time, scrolling a long chat, leaving the app and returning.

## Next stages

Stage 3 media/voice (needs storage choice; Firebase Storage needs Blaze), Stage 4 groups/notifications/block/report,
Stage 5 calls (WebRTC + signaling + TURN), Stage 6 hardening and Android packaging (Capacitor).
