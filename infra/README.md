# infra

Environment configuration that is applied by hand to external services, as
opposed to code that runs when the app does. Each file is applied by a mise
task where one exists; see the root README's Deploy section for when to run
them.

| File | Purpose | Applied by |
| --- | --- | --- |
| `gcs/cors.json` | CORS policy for the `SEPARATED_TRACKS_BUCKET` Google Cloud Storage bucket. Lets the browser on `the-tuul.com` and `beta.the-tuul.com` GET finished separation results straight from the bucket. | `mise run gcs-cors` |
