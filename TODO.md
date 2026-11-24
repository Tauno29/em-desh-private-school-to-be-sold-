# TODO

## Landing-page content management

- [ ] The landing page no longer loads or displays the welcome video.
- [ ] The landing page displays a notification banner that can be enabled, disabled, and edited by an authenticated staff member.
- [ ] The staff dashboard lets the admin upload and replace the landing-page hero image without exposing storage credentials.
- [ ] The staff dashboard lets the admin mark uploaded photos as homepage recent-event images, remove that placement, and delete photos.
- [ ] The landing page displays recent-event images in switchable, keyboard-accessible image containers with captions and safe empty/loading states.
- [ ] Existing public gallery, learner, application, session, and storage workflows remain compatible.
- [ ] The MySQL database remains the production database; no CSV learner data is imported automatically.

## Bulk learner registration

- [x] The staff dashboard retains the existing individual “Register learner” flow and adds an “Import CSV” action.
- [x] The admin can download a CSV template with one learner per row and the supported headers.
- [x] The admin can select a CSV file without writing any data, then see a preview before import.
- [x] The preview validates required names and grades, accepts optional class and guardian details, flags malformed rows, and detects duplicates within the file and against currently loaded learners.
- [x] The import action is explicit, sends only valid rows through the existing authenticated learner-registration endpoint, and reports successes and failures.
- [x] The results show generated student IDs and one-time PINs in a print-ready credentials sheet, with a warning that the PINs cannot be recovered later.
- [x] Existing production data is not changed until the admin confirms an import.
