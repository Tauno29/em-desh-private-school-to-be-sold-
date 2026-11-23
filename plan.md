# Bulk learner registration

## Implementation

Add a staff-only CSV import workflow to the existing learner dashboard without changing the production database schema or individual registration flow. The browser will download a CSV template, parse and validate one learner per row, preview valid and invalid rows, detect duplicates against the current learner list and within the file, then call the existing authenticated learner-registration endpoint sequentially for confirmed valid rows. Generated student IDs and one-time PINs will be collected in a printable results view. No import is sent until the admin confirms it.

## Design

- **Design movement:** Quiet school-office utility: calm, structured, and practical.
- **Core principles:** clear next action, visible validation, reversible review before write, and credentials treated as one-time information.
- **Color philosophy:** reuse the existing deep green, warm paper, and amber status colors so the workflow feels native to the dashboard.
- **Layout paradigm:** a focused wide sheet that moves from instructions to preview to results.
- **Signature elements:** compact step labels, validation summary chips, and a print-ready credential list.
- **Interaction philosophy:** never write rows during file selection; make the import action explicit and disable it while rows are being created.
- **Typography system:** preserve the existing Fraunces headings and Inter interface text.
- **Brand essence:** a trustworthy school office tool for registering a whole class accurately; calm, careful, useful.
- **Brand voice:** “Review every row before saving.” and “Keep this credential sheet safe.”

## Project structure

- `admin.html`: bulk-import and credentials dialog markup.
- `admin.js`: CSV parsing, validation, preview, import, and print interactions.
- `styles.css`: responsive dialog, preview table, validation states, and printable credential styles.
- Existing `functions/routes.mjs`: unchanged; imports reuse the authenticated `POST /api/admin/learners` route.
