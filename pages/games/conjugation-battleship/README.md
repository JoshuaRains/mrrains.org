# Conjugation Battleship

Open `/pages/games/conjugation-battleship/` through the site's normal HTTP server. This is a separate game; the previous battleship pages remain available.

## Firebase setup

1. In project `battleship-2b754`, enable Authentication → Email/Password and create `test@gmail.com` with your classroom password. Students enter only that password; it is never stored in this repository. Authentication lasts only for the current page session.
2. Publish the accompanying `database.rules.json` in the Realtime Database Rules tab. If this database already serves other apps, merge the `conjugationBattleship` branch into its existing rules rather than replacing other app rules. Remove any broader public access rule that overrides these restrictions.
3. Serve this directory on the website. Both students log in, enter display names, and create/join using the six-character room code.

The game uses Firebase JS SDK 12.19.0 and the supplied project configuration. No additional build step is required. The Firebase project and account must be configured by someone with console access; adding these files does not publish database rules or create the login account.

## Play

Each match draws two verbs from each regular ending group, exclusively from `Notes - Regular Verbs, Pronouns, Conjugation.pdf`. Six columns represent yo, tú, él/ella/usted, nosotros/as, vosotros/as, and ellos/ellas/ustedes. Present-tense accents and ñ are required; capitalization and surrounding whitespace are ignored.

Place ships of lengths 3, 2, 2, and 1 by clicking their starting cells, or shuffle the entire fleet. Lock in the fleet. The host starts once both players are ready. Every accepted attack passes the turn, whether hit or miss.

Type a conjugation to choose its intersection, then press Enter. Clicking an enemy cell is optional and sets a target to conjugate; clicks and accent buttons never fire. Incorrect answers remain red until corrected and never consume a turn. Repeated shots and out-of-turn attacks are rejected. A disconnected player can refresh, log in again, and resume in the same tab. Closing the tab loses its captain session; start a new room if necessary. Finished rooms remain in the database and can be removed in the console.

## Classroom trust model

As requested, all students use the same Firebase account. Per-tab captain IDs distinguish players, and RTDB transactions serialize room joins, readiness, and attacks. These IDs are not independent authentication credentials: an authenticated student with developer tools can inspect fleets or alter room data. This is suitable for a supervised classroom activity, not adversarial competitive play. Enforcing hidden fleets and tamper-proof answers would require separate player identities and a trusted backend.

## Verification

Run `node --test pages/games/conjugation-battleship/engine.test.mjs` from the repository root. Tests cover conjugation and accent handling, source-only selection, placement, invalid/duplicate/out-of-turn shots, hit/miss outcomes, sinking, and victory.

Firebase references: https://firebase.google.com/docs/auth/web/password-auth and https://firebase.google.com/docs/database/web/read-and-write.
