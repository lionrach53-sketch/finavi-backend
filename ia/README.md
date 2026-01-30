Usage
-----

This folder contains a minimal OpenAI client helper `openaiClient.js` used by the API to fetch contextual financial advice.

Setup

- Set your OpenAI API key in the environment variable `OPENAI_API_KEY` (recommended).

Example:

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm start
```

Endpoint

The backend exposes a POST `/api/ai/advice` endpoint (implemented in `serve.js`) which accepts a JSON body with `userId` and optional `context`. The server will enrich or forward that context to OpenAI and return the advice in French.

Security

- Do NOT commit your API key to source control.
- In production, use a secrets manager or environment injection.

Push notifications
------------------
- To enable web push you need VAPID keys. Generate them locally using the `web-push` package:

```powershell
npx web-push generate-vapid-keys --json
```

Take the `publicKey` and `privateKey` and set them in your `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

- Install the `web-push` package in the backend:

```powershell
npm install web-push
```

The app exposes `/api/push/vapidPublicKey` for the frontend to fetch the public key and `/api/push/subscribe` to store subscriptions.
