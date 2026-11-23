# TODO

## Bulk learner registration

- [x] The staff dashboard retains the existing individual “Register learner” flow and adds an “Import CSV” action.
- [x] The admin can download a CSV template with one learner per row and the supported headers.
- [x] The admin can select a CSV file without writing any data, then see a preview before import.
- [x] The preview validates required names and grades, accepts optional class and guardian details, flags malformed rows, and detects duplicates within the file and against currently loaded learners.
- [x] The import action is explicit, sends only valid rows through the existing authenticated learner-registration endpoint, and reports successes and failures.
- [x] The results show generated student IDs and one-time PINs in a print-ready credentials sheet, with a warning that the PINs cannot be recovered later.
- [x] Existing production data is not changed until the admin confirms an import.
