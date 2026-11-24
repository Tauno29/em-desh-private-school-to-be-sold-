# Landing page content management

## Implementation

Extend the existing MySQL-backed gallery workflow with a small `site_settings` table and homepage placement metadata on `gallery_images`. Staff can edit a notification banner, upload a replacement hero image, and upload or assign recent-event photos to homepage news slots. The public landing page loads this content through a public API endpoint, removes the welcome video, renders a safe local hero fallback until a staff image is selected, and rotates recent-event images with accessible previous/next controls. Existing gallery uploads and learner/admin workflows remain intact.

## Design

- **Design movement:** Editorial school bulletin: a calm green-and-paper landing page with a clear notice strip and rotating event cards.
- **Core principles:** visible school updates, simple staff editing, safe empty states, and accessible controls.
- **Color philosophy:** use the existing forest green, cream, and light border palette so notices feel native rather than promotional.
- **Layout paradigm:** a compact notice above the hero, an image-led hero, and a focused recent-events rail before the school facts.
- **Signature elements:** amber notice accent, framed hero image, and numbered event carousel controls.
- **Interaction philosophy:** public content never blocks the page if unavailable; carousel controls are keyboard-friendly and pause between changes.
- **Typography system:** preserve Fraunces for school/editorial headings and Inter for controls and metadata.
- **Brand essence:** a living school noticeboard for families in Okahao; warm, current, trustworthy.
- **Brand voice:** “School updates, shared from the office.” and “See what has been happening at Em-Desh.”

## Project structure

- `index.html`, `app.js`, `styles.css`: landing notification, fallback hero, and recent-event carousel.
- `admin.html`, `admin.js`: staff content editor and gallery placement controls.
- `functions/routes.mjs`: public homepage-content endpoint and protected settings/placement routes.
- `server.mjs`: MySQL settings table and backward-compatible gallery metadata migration.
- `dev/test.mjs`: regression coverage for homepage content, settings, and placement controls.
