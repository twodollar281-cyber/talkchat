TALKCHAT V2 - TERMUX SETUP

1) Keep a backup of your current project before replacing files.
2) Copy the V2 files into your existing ~/talkchat folder.
3) Do NOT delete or overwrite the old root users.json file.
4) In Termux, from ~/talkchat run:
   npm install
5) Start:
   npm start
6) Open:
   http://localhost:3000

On first start, V2 automatically copies existing accounts from the old
root users.json into data/users.json, preserving usernames and password hashes.
Keep the original users.json as a backup until you confirm you can log in.

V2 creates data/posts.json, notifications.json, conversations.json and
messages.json automatically. Uploads are stored in public/uploads.
Maximum upload size is 30 MB.

This is a prototype using JSON files and Express's default in-memory session
store. Do not expose it publicly yet. Before public deployment, configure a
strong SESSION_SECRET, HTTPS, persistent session storage, a proper database,
backups, moderation/reporting, and stronger upload/content controls.
