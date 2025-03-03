import { ethers } from 'ethers';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected');

  // Handle getSafeInfo event
  socket.on('getSafeInfo', async (data) => {
    try {
      const { safeAddress, network, chainId, provider } = data;
      
      if (!safeAddress) {
        socket.emit('error', { message: 'Missing Safe address' });
        return;
      }

      // Use the network-specific provider sent from the client
      const networkProvider = new ethers.JsonRpcProvider(provider);
      const safeAbi = [
        'function getOwners() external view returns (address[] memory)',
        'function getThreshold() external view returns (uint256)',
        'function nonce() external view returns (uint256)',
        'function VERSION() external view returns (string)'
      ];

      const safeContract = new ethers.Contract(safeAddress, safeAbi, networkProvider);

      const [owners, threshold, nonce, version] = await Promise.all([
        safeContract.getOwners(),
        safeContract.getThreshold(),
        safeContract.nonce(),
        safeContract.VERSION().catch(() => 'Unknown')
      ]);

      socket.emit('safeInfo', {
        address: safeAddress,
        owners,
        threshold: Number(threshold),
        nonce: Number(nonce),
        version,
        chainId // Include chainId in the response
      });
    } catch (error) {
      console.error('Error getting Safe info:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle getPendingTransactions event
  socket.on('getPendingTransactions', async (data) => {
    try {
      const { safeAddress } = data;
      
      if (!safeAddress) {
        socket.emit('error', { message: 'Missing Safe address' });
        return;
      }

      // Return empty results with notice since Safe API is not available
      socket.emit('pendingTransactions', {
        transactions: [],
        notice: 'Transaction history is currently unavailable. This feature will be enabled when the Safe API service is live.'
      });
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle prepareTransaction event
  socket.on('prepareTransaction', async (data) => {
    try {
      const { safeAddress, transaction, network, chainId, provider } = data;
      
      if (!safeAddress || !transaction) {
        socket.emit('error', { message: 'Missing required parameters' });
        return;
      }

      // Use the network-specific provider sent from the client
      const networkProvider = new ethers.JsonRpcProvider(provider);
      const safeAbi = [
        'function nonce() external view returns (uint256)',
        'function getThreshold() external view returns (uint256)',
        'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) external view returns (bytes32)'
      ];

      const safeContract = new ethers.Contract(safeAddress, safeAbi, networkProvider);

      // Get current nonce and threshold
      const [nonce, threshold] = await Promise.all([
        safeContract.nonce(),
        safeContract.getThreshold()
      ]);

      // Convert value to proper format
      const valueInWei = transaction.value ? ethers.parseEther(transaction.value) : 0n;

      // Prepare transaction data
      const txData = {
        to: transaction.to,
        value: valueInWei.toString(),
        data: transaction.data || '0x',
        operation: transaction.operation || 0,
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: '0x0000000000000000000000000000000000000000',
        refundReceiver: '0x0000000000000000000000000000000000000000',
        nonce: nonce.toString()
      };

      // Get transaction hash
      const safeTxHash = await safeContract.getTransactionHash(
        txData.to,
        txData.value,
        txData.data,
        txData.operation,
        txData.safeTxGas,
        txData.baseGas,
        txData.gasPrice,
        txData.gasToken,
        txData.refundReceiver,
        txData.nonce
      );

      socket.emit('transactionPrepared', {
        ...txData,
        safeTxHash,
        threshold: Number(threshold),
        chainId // Include chainId in the response
      });
    } catch (error) {
      console.error('Error preparing transaction:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle submitSignature event
  socket.on('submitSignature', async (data) => {
    try {
      const { network, chainId, provider } = data;
      
      // Use the network-specific provider sent from the client
      const networkProvider = new ethers.JsonRpcProvider(provider);
      
      socket.emit('error', { 
        message: 'Signature submission is currently unavailable. This feature will be enabled when the Safe API service is live.'
      });
    } catch (error) {
      console.error('Error submitting signature:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle executeTransaction event
  socket.on('executeTransaction', async (data) => {
    try {
      const { network, chainId, provider } = data;
      
      // Use the network-specific provider sent from the client
      const networkProvider = new ethers.JsonRpcProvider(provider);
      
      socket.emit('error', { 
        message: 'Transaction execution is currently unavailable. This feature will be enabled when the Safe API service is live.'
      });
    } catch (error) {
      console.error('Error executing transaction:', error);
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Export for testing
export { app, server, io }; 