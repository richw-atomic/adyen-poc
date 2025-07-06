# Adyen Proof of Concept

This repository contains a proof-of-concept implementation for integrating with the Adyen payment gateway.

## Functionality

The application provides a basic server with the following functionalities:

*   **Order Management:** Endpoints for creating and managing orders.
*   **Payment Processing:** Endpoints for handling various payment flows with Adyen.
*   **Stored Payment Methods:** Functionality for managing stored payment details.
*   **Webhooks:** A route for receiving and processing Adyen webhooks.

## Tech Stack

*   **Backend:** Node.js with Express.js
*   **Database:** NeDB (a simple file-based database)
*   **Adyen Integration:** `@adyen/api-library`

## How to Run Locally

### Prerequisites

*   [Node.js](https://nodejs.org/) (v14 or higher)
*   [npm](https://www.npmjs.com/)

### 1. Clone the repository

```bash
git clone https://github.com/richw-atomic/adyen-poc.git
cd adyen-poc
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file by copying the example file:

```bash
cp .env.example .env
```

Update the `.env` file with the following steps:

#### Configure ngrok
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

#### Setup webhooks and HMAC
Log in to your Adyen Customer Area (Test environment for this POC).

1. Navigate to Developers > Webhooks.

1. Create a new webhook.
1. Click on "Standard notification" (or similar, like "Standard webhook").
1. Enter the URL provided by ngrok followed by `/api/webhooks` (e.g., `https://{your-ngrok-subdomain}.ngrok.io/api/webhooks`).
1. Generate an HMAC key for security.
1. Copy the key into your `.env` file as `ADYEN_HMAC_KEY`.

#### Setup Adyen API credentials
1. In your Adyen Customer Area, navigate to Developers > API credentials.
2. Create a new API credential with the following permissions:
   - Payments
   - Payment methods
   - Orders
3. Copy the API key and paste it into your `.env` file as `ADYEN_API_KEY`.
4. Set your merchant account name in the `.env` file as `ADYEN_MERCHANT_ACCOUNT`.
5. Set your client key in the `.env` file as `ADYEN_CLIENT_KEY`.

### 4. Start the application

```bash
npm start
```

The application will be running on the port specified in your configuration.

## Troubleshooting

1. No response from Adyen?
   - Ensure your ngrok tunnel is running and the URL is correctly set in your Adyen webhook configuration.
   - Check the logs for any errors related to Adyen API calls.

1. No redirect after 3ds2 challenge?
   - Ensure the `clientReturnUrl` is correctly set in your payment payload.
   - Check the logs for any errors related to the payment processing.
   - Ensure you have whitelisted the `clientReturnUrl` in your Adyen Customer Area.
   - Ensure the protocol for `clientReturnUrl` matches the whitelisted URLs in your Adyen Customer Area.