# Maintaining the TalkChat AI knowledge base

The assistant's verified feature index is `talkchatKnowledge.js`. It is deliberately small and sends only the top three matches for a user message; it never sends the full repository or user account records to Cloudflare.

## Updating it

1. Implement and verify the feature in the active UI/server code.
2. Add or update a knowledge entry with short aliases, the verified navigation steps, an optional in-app navigation action, and the source files.
3. Add a retrieval test for the feature to `test/ai-assistant.test.js`.
4. Confirm any role, ownership, privacy, or device limitations in the actual server route before describing them.

Do not cite `backups/` as current behavior. If a feature cannot be confirmed from active UI and server code, leave it out so the assistant asks instead of guessing.

## Current feature areas indexed

- Main navigation, Discover, profile and privacy settings, posts, Stories and Reels
- Private and group messages, Story/message requests, message editing/actions, calls
- Notifications, live streams, saved collections and chat themes
- Blocking/reporting and role-gated moderation
- Sign-in and registration

The index is not account data. It describes where verified features live, not whether an individual user has permission to use a particular item. All sensitive data and action permissions remain enforced by TalkChat's existing authenticated server routes.
