# Follow-up tasks (owner requests outside the sprint checklists)

| # | Added | Task | Owner | Status |
|---|---|---|---|---|
| F1 | 2026-11-03 | Barcode scanner must really work: "Point the camera at the label, or type the code." Native `BarcodeDetector` with `@zxing/browser` fallback, environment camera, duplicate debounce, `GET /variants/lookup` on hit, typed-code fallback, permission-denied handling, stop tracks on close. Needs a secure context (https) on LAN devices. | frontend session (`src/components/app/BarcodeScanner.tsx`) | requested |
