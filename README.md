# Adyen Proof of Concept

This repository contains a proof-of-concept implementation for integrating with the Adyen payment gateway, focusing on the **Advanced Flow** (Orders API) to support multiple payments against a single order.

## Functionality

The application provides a basic server with the following functionalities:

*   **Order Management:** Endpoints for creating and managing orders, which can then be partially or fully paid.
*   **Payment Processing:** Endpoints for handling individual payment attempts against an order, including 3D Secure challenges.
*   **Stored Payment Methods:** Functionality for managing stored payment details (tokens).
*   **Webhooks:** A route for receiving and processing Adyen webhooks to update order and payment statuses asynchronously.

## Tech Stack

*   **Backend:** Node.js with Express.js
*   **Frontend:** EJS templates with Alpine.js for dynamic UI, using Adyen Web Components.
*   **Database:** NeDB (a simple file-based database)
*   **Adyen Integration:** `@adyen/api-library` (backend) and `@adyen/adyen-web` (frontend)

## Diagrams

To help understand the project's structure and data flow, several Mermaid diagrams have been generated:

*   **Sequence Diagram (`sequence-diagram.mermaid`)**:
    Provides a detailed, step-by-step chronological view of interactions between the different systems during a transaction.
*   **Entity Diagram (`advanced-flow-entity-diagram.mermaid`)**:
    Defines the structure of key JSON payloads (entities) exchanged between your application and Adyen, highlighting the data contracts for the Advanced (Orders) Flow.
*   **Architecture Diagram (`architecture-diagram.mermaid`)**:
    A simple overview of the main components of the system and their primary communication channels.

### How to View Diagrams

These diagrams are in [Mermaid](https://mermaid.js.org/) syntax. You can view them using:

*   **Mermaid Live Editor:** Copy the content of any `.mermaid` file and paste it into the [Mermaid Live Editor](https://mermaid.live/).
*   **VS Code Extensions:** Install extensions like "Mermaid Preview" or "Markdown Preview Enhanced" in Visual Studio Code.
*   **GitHub:** GitHub automatically renders Mermaid diagrams in `.md` files.

## Postman Collection

A Postman collection (`postman_collection.json`) is provided to help you test the API endpoints locally.

### How to Import and Use

1.  **Import:** In Postman, click `File > Import` and select the `postman_collection.json` file from the project root.
2.  **Environment:** The collection uses a `baseUrl` variable (defaulting to `http://localhost:8080`). You can set up a Postman environment to manage this and other variables (like `orderId`).
3.  **Order ID Variable:** The "Create Order" request has a post-response script that automatically sets a collection variable named `orderId` with the ID of the newly created order. This `orderId` can then be used in subsequent requests (e.g., "Cancel Order", "Make Payment") by referencing `{{orderId}}`.

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
