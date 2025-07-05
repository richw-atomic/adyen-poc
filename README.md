# Adyen POC with partial payments using Node.js and Express

## Configure ngrok
When running locally you will need to expose your local server to the internet so that Adyen can send webhooks to it. You can use ngrok for this.
1. Install ngrok if you haven't already: https://ngrok.com/download
2. Start ngrok with the command:
   ```bash
   ngrok http 3000
   ```
    If you can set a specific domain in ngrok, specify this in the command
    ```bash
    ngrok http --domain={your-domain} 3000
    ```

## Setup webhooks and HMAC
Log in to your Adyen Customer Area (Test environment for this POC).

1. Navigate to Developers > Webhooks.

1. Create a new webhook.
1. Click on "Standard notification" (or similar, like "Standard webhook").
1. Enter the URL provided by ngrok followed by `/api/webhooks` (e.g., `https://{your-ngrok-subdomain}.ngrok.io/api/webhooks`).
1. Generate an HMAC key for security.
1. Copy the key into your `.env` file as `ADYEN_HMAC_KEY`.
