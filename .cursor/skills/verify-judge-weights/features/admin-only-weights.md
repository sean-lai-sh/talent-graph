# Admin-only weights

A signed-in member never receives judge weights, credit parts, or recognition answers. An admin can open the committee pages.

## Sub-features

- `member-queries` — every public Convex query, called as a member, has no weight key. Weight-returning queries reject the member.
- `member-views` — directory, inbox, lookup, and ladder objects have no weight keys.
- `member-browser` — Forum, Member List, and Submit Referral, plus the `/members` network capture.
- `admin-pages` — `/admin` and any other `/admin` link, screenshotted as the admin. A 404 still gets a snapshot.

## How to get to it (user POV)

- Sign in at `/login` as `ada.quill@example.test`, then use Forum, Member List, and Submit Referral.
- Sign out, sign in as `council.clerk@example.test`, and open `/admin`.

## Driving it with cursor-ide-browser

Preconditions: doctor printed a loopback URL, the local Convex backend is up, and both synthetic accounts exist.

- Open the member forum: `chrome-drive.ts goto <app>/login`, type Email and Password, click `Sign in`, wait for `Forum`. Save `01-forum.aria.txt` and `01-forum.png`.
- Open the directory: click `Member List`. Save `02-member-list.aria.txt` and `02-member-list.png`.
- Open referral: click `Submit Referral`. Save `03-referral.aria.txt` and `03-referral.png`.
- Capture traffic: `chrome-drive.ts capture <app>/members <network dir>`. Fail if there is no JSON body and no websocket frame. Fail if a scanned payload has a weight key.
- Open committee: sign out, sign in as the admin, wait for `Council`, goto `<app>/admin`. Save `01-admin.aria.txt` and `01-admin.png`.

## Gotchas

- The scan matches keys, including a nested `w` inside an array of objects. It does not match prose or JS bundles.
- `/admin` does not exist on main yet. Screenshot the 404. Do not fail the check for that.
- Do not count this check as passed when the member payload scan failed.
