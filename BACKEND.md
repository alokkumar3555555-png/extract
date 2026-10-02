# Extractor backend API

Run npm install, copy .env.local.example to .env.local, configure the three Firebase Admin variables, and run npm run dev. Enable Firestore and use a service account with Firestore permissions. Keep .env.local private. Escaped \n in the private key is converted to real newlines. OCR needs no API keys or billing account; Firebase credentials are only for saving/listing/deleting data.

## Local extraction architecture

Image → Sharp preprocessing → Tesseract.js English OCR → deterministic evidence classifier → Aadhaar/PAN/Indian Driving Licence parser → normalized, validated response.

No external OCR/AI API is used. tesseract.js, sharp, and the bundled @tesseract.js-data/eng language package run locally. Language data, worker scripts and WASM are installed with npm and traced into the extract route; there are no runtime language/model downloads. No image is uploaded anywhere, saved to host disk, retained as base64, or automatically stored in Firestore. Raw OCR text, names, addresses, document numbers and phone numbers are not logged or returned as debug metadata.

Sharp auto-orients using EXIF, flattens transparency onto white, converts to grayscale, gently normalizes contrast and sharpens, and resizes the longest edge to at most 2400 pixels (small images are upscaled by at most 2x). Decoded input is capped at 20 million pixels; only single-frame JPEG/PNG/WebP is accepted. All intermediate images are buffers.

One reusable OCR worker per module/process processes one job at a time. Concurrent jobs receive 503 rather than retaining an unbounded queue of sensitive images. Each job removes Tesseract's image from its in-memory WASM filesystem and resets the engine before reuse. The worker terminates after 30 seconds idle, on errors, or at the 40-second OCR deadline. Application image buffers are wiped in finally blocks; immutable OCR strings become eligible for garbage collection after the request. No guarantee of forensic RAM zeroization is made.

## POST /api/extract

Send multipart/form-data with exactly one field file containing a nonempty JPEG, PNG or WebP image. Maximum file size: 10 MiB (10 * 1024 * 1024 bytes); multipart overhead is capped at 64 KiB.

Example: curl -X POST http://localhost:3000/api/extract -F "file=@synthetic-id.png"

200 response example (obviously synthetic test data):
```json
{"success":true,"data":{"idType":"pan","name":"SYNTHETIC USER","documentNumber":"ABCDE0000Z","address":null,"phoneNumber":null}}
```

Public data fields remain idType, name, documentNumber, address, phoneNumber. idType belongs to aadhaar, pan, driving_licence, unknown; other fields are string or null. Unknown/unusable OCR returns 422 in this first version. At least a usable holder name or document number must be extracted. Raw OCR text and confidence are internal only. Extraction and saving remain separate operations.

## Parsing limitations

Accuracy depends on image quality, lighting, text size, orientation and layout. English OCR is used initially; Hindi/regional scripts, handwriting, QR codes and complex mixed-column layouts are not supported. No ML classifier or checksum/document-authenticity verification is implemented. Known labels and nearby lines drive name/address extraction. The deterministic classifier scores branding plus number and contextual evidence; weak clues alone or conflicting scores return unknown. Multiple number candidates return null. PAN case/spacing and Aadhaar grouping are normalized, but ambiguous O/0 or I/1 characters are not guessed. DL formats vary by state, so unfamiliar formats may return null. Phone numbers require an explicit holder mobile/phone/contact label; office/helpline numbers and unlabeled numbers are ignored. No country code is invented. Review extracted fields before saving.

## POST /api/extractions

Send application/json with all five fields. idType must be aadhaar, pan, driving_licence, or unknown. Each other field must be a string or null. Extra fields (including userId, image, URL and base64) are rejected. String limits: name 200, documentNumber 100, address 2000, phoneNumber 50 characters. JSON body limit: 16 KiB. userId is assigned null by the server; createdAt is a Firestore server timestamp returned as an ISO string.

Example: curl -X POST http://localhost:3000/api/extractions -H "Content-Type: application/json" -d '{"idType":"aadhaar","name":"Demo User","documentNumber":"XXXX XXXX 1234","address":"Pune, Maharashtra","phoneNumber":null}'

201 response:
```json
{"success":true,"data":{"id":"example-id","idType":"aadhaar","name":"Demo User","documentNumber":"XXXX XXXX 1234","address":"Pune, Maharashtra","phoneNumber":null,"userId":null,"createdAt":"2026-10-02T00:00:00.000Z"}}
```

## GET /api/extractions

Example: curl http://localhost:3000/api/extractions

200 response: {"success":true,"data":[]} (or an array of stored records in the format above, newest first). This initial endpoint lists all records without pagination. The repository accepts a trusted userId filter for future authentication integration.

## GET /api/extractions/[id]

Example: curl http://localhost:3000/api/extractions/example-id

200 response: {"success":true,"data":{...stored record above...}}

## DELETE /api/extractions/[id]

Example: curl -X DELETE http://localhost:3000/api/extractions/example-id

200 response: {"success":true,"data":{"id":"example-id","deleted":true}}

## Errors and testing

Responses always use {"success":true,"data":...} or {"success":false,"error":"..."}, with Cache-Control: no-store.

400: missing/empty file or malformed input. 413: oversized upload/body. 415: unsupported MIME/content type. 422: corrupt/unsupported image, unknown or unusable document, or invalid parsed output. 500: internal OCR/configuration or database failure. 503: worker busy or OCR deadline exceeded. Single-record CRUD returns 404 for nonexistent records. Errors never include internal stack traces or raw personal data.

Run npm run test:backend for synthetic OCR text fixtures, handler validation, worker lifecycle/concurrency/timeout tests, and a real Sharp/Tesseract integration test using an in-memory synthetic image. No real government IDs or live Firestore are used by these tests.

The extract route uses Node.js and maxDuration 60. Vercel or other hosts may impose lower upload limits, execution durations, memory quotas or package-size limits. CPU-heavy OCR and language/WASM assets need suitable server resources; verify these limits before a future deployment. No deployment is included. Firestore CRUD and frontend remain unchanged; no authentication, Firebase Storage or image history was added.
