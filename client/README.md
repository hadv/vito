# Vim Safe App
A Vim-like web app for sending Safe transactions using WalletConnect.

## Setup
1. **Install dependencies**: `npm run install:all`
2. **Fill environment variables**:
   - `server/.env`: Add `WALLETCONNECT_PROJECT_ID`, `INFURA_KEY`, `SAFE_ADDRESS`
   - `client/.env`: Add `VITE_SAFE_ADDRESS`, `VITE_API_URL`
3. **Run**: `npm run start`

## Commands
- `:walletconnect` - Connect wallet via WalletConnect
- `:send` - Send a Safe transaction
- `:q` - Clear the buffer
