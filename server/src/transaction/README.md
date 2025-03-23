# Safe Wallet Transaction Service

This module provides functionality to fetch transaction history for Safe wallets using the Etherscan API.

## Features

- Fetches blockchain transaction history from Etherscan API
- Supports multiple chains (Ethereum, Polygon, Optimism, etc.)
- Provides in-memory caching to reduce API calls
- Implements pagination support for large transaction histories

## API Endpoints

### GET /transactions/blockchain

Fetches blockchain transactions for a Safe wallet.

**Query Parameters:**
- `safeAddress` (required): The address of the Safe wallet
- `chainId` (optional, default: 1): The chain ID (1 = Ethereum mainnet)
- `limit` (optional, default: 100): Number of transactions to fetch
- `offset` (optional, default: 0): Offset for pagination

**Example Request:**
```
GET /transactions/blockchain?safeAddress=0x1234...5678&chainId=1&limit=50&offset=0
```

**Example Response:**
```json
{
  "transactions": [
    {
      "id": "0x...",
      "timestamp": 1634567890,
      "txHash": "0x...",
      "value": "1000000000000000000",
      "nonce": 5,
      "to": "0x...",
      "data": "0x...",
      "operation": 0,
      "safeTxHash": "0x...",
      "executor": "0x...",
      "executionDate": "2023-01-01T00:00:00Z",
      "confirmations": [
        {
          "owner": "0x...",
          "signature": "0x...",
          "submissionDate": "2023-01-01T00:00:00Z"
        }
      ],
      "isExecuted": true,
      "dataDecoded": {
        "method": "Incoming Transaction",
        "parameters": []
      }
    }
  ]
}
```

## Usage in Code

```typescript
// Inject the service
constructor(private readonly transactionService: TransactionService) {}

// Get blockchain transactions
const transactions = await this.transactionService.getBlockchainTransactions(
  '0x1234...5678', // Safe address
  1,               // Chain ID (Ethereum mainnet)
  100,             // Limit
  0                // Offset
);
```

## Implementation Details

- **Caching**: Transactions are cached in-memory for 5 minutes to reduce API calls
- **Pagination**: The service handles pagination correctly by fetching additional transactions as needed
- **Single API Key**: Uses a single Etherscan API key for all supported networks

## Supported Chains

- 1: Ethereum Mainnet
- 5: Goerli Testnet
- 11155111: Sepolia Testnet
- 137: Polygon
- 80001: Mumbai Testnet (Polygon)
- 8453: Base
- 100: Gnosis Chain
- 10: Optimism 

## Environment Configuration

Set up a single API key for all networks:

```
ETHERSCAN_API_KEY=your_etherscan_api_key
```

The same API key will be used across all supported networks (Ethereum, Polygon, Optimism, etc.). 