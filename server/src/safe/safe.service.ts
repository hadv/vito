import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { SafeInfo, SafeTransaction, SafeTransactionDataPartial } from './types';

@Injectable()
export class SafeService {
  private networks: { [key: string]: { chainId: number; provider: string; safeTxPool: string } };

  constructor(private readonly configService: ConfigService) {
    const alchemyApiKey = this.configService.get<string>('ALCHEMY_API_KEY');
    if (!alchemyApiKey) {
      throw new Error('ALCHEMY_API_KEY environment variable is not set');
    }

    this.networks = {
    mainnet: {
      chainId: 1,
        provider: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
        safeTxPool: '0x...' // Add mainnet address
    },
    arbitrum: {
      chainId: 42161,
        provider: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
        safeTxPool: '0x...' // Add arbitrum address
    },
    sepolia: {
      chainId: 11155111,
        provider: `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`,
        safeTxPool: '0xa2ad21dc93B362570D0159b9E3A2fE5D8ecA0424' // Sepolia SafeTxPool address
      }
  };
  }

  private getProvider(network: string): ethers.JsonRpcProvider {
    const networkConfig = this.networks[network];
    if (!networkConfig) {
      throw new Error(`Unsupported network: ${network}`);
    }
    return new ethers.JsonRpcProvider(networkConfig.provider);
  }

  async getSafeInfo(safeAddress: string, network: string): Promise<SafeInfo> {
    const provider = this.getProvider(network);
    const safeContract = new ethers.Contract(
      safeAddress,
      ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'],
      provider
    );

    const [owners, threshold] = await Promise.all([
      safeContract.getOwners(),
      safeContract.getThreshold(),
    ]);

    return {
      address: safeAddress,
      owners,
      threshold: Number(threshold),
      chainId: this.networks[network].chainId
    };
  }

  async prepareTransaction(
    safeAddress: string,
    to: string,
    value: string,
    data: string,
    operation: number,
    network: string,
  ): Promise<SafeTransactionDataPartial & { safeTxHash: string; threshold: number; typedData: any }> {
    try {
      console.log('Starting prepareTransaction with params:', {
        safeAddress,
        to,
        value,
        data,
        operation,
        network
      });

      // Validate addresses
      if (!ethers.isAddress(safeAddress)) {
        throw new Error(`Invalid Safe address: ${safeAddress}`);
      }
      if (!ethers.isAddress(to)) {
        throw new Error(`Invalid destination address: ${to}`);
      }

      // Get provider and verify network configuration
      console.log('Available networks:', Object.keys(this.networks));
    const provider = this.getProvider(network);
      console.log('Provider created for network:', network);

      // Verify Safe exists on network
      console.log('Checking if Safe exists on network...');
      const code = await provider.getCode(safeAddress);
      console.log('Safe contract code:', code);
      if (code === '0x') {
        throw new Error(`Safe does not exist on ${network}`);
      }

      // Create Safe contract instance
      console.log('Creating Safe contract instance...');
    const safeContract = new ethers.Contract(
      safeAddress,
        [
          'function nonce() view returns (uint256)',
          'function getThreshold() view returns (uint256)',
          'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)'
        ],
      provider
    );
      console.log('Safe contract instance created');

      // Get nonce and threshold
      console.log('Fetching nonce and threshold...');
    const [nonce, threshold] = await Promise.all([
      safeContract.nonce(),
      safeContract.getThreshold()
    ]);
      console.log('Retrieved nonce and threshold:', { 
        nonce: nonce.toString(), 
        threshold: threshold.toString() 
      });

      // Validate value format
      console.log('Validating value format:', value);
      let valueHex = value;
      if (!value.startsWith('0x')) {
        try {
          // Convert decimal string to BigInt and then to hex
          valueHex = `0x${BigInt(value).toString(16)}`;
        } catch (error) {
          throw new Error(`Invalid value format: ${value}`);
        }
      }
      if (!ethers.isHexString(valueHex)) {
        throw new Error(`Invalid value format: ${value}`);
      }

      // Validate data format
      console.log('Validating data format:', data);
      if (!ethers.isHexString(data)) {
        throw new Error(`Invalid data format: ${data}`);
      }

      // Prepare transaction object
      console.log('Preparing transaction object...');
    const transaction = {
      to,
        value: valueHex,
      data,
      operation,
      nonce: nonce.toString(),
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
    };
      console.log('Transaction object prepared:', JSON.stringify(transaction, null, 2));

      // Get transaction hash from contract
      console.log('Getting transaction hash from contract...');
      const safeTxHash = await safeContract.getTransactionHash(
        transaction.to,
        transaction.value,
        transaction.data,
        transaction.operation,
        transaction.safeTxGas,
        transaction.baseGas,
        transaction.gasPrice,
        transaction.gasToken,
        transaction.refundReceiver,
        transaction.nonce
      );
      console.log('Retrieved safeTxHash from contract:', safeTxHash);

      // Calculate transaction hash
      const txHash = ethers.keccak256(
        ethers.solidityPacked(
      ['address', 'uint256', 'bytes', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
          [
            transaction.to,
            transaction.value,
            transaction.data,
            transaction.operation,
            transaction.safeTxGas,
            transaction.baseGas,
            transaction.gasPrice,
            transaction.gasToken,
            transaction.refundReceiver,
            transaction.nonce
          ]
        )
      );
      console.log('Calculated txHash:', txHash);

      // Prepare EIP-712 typed data
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'verifyingContract', type: 'address' },
            { name: 'chainId', type: 'uint256' }
          ],
          SafeTx: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
            { name: 'operation', type: 'uint8' },
            { name: 'safeTxGas', type: 'uint256' },
            { name: 'baseGas', type: 'uint256' },
            { name: 'gasPrice', type: 'uint256' },
            { name: 'gasToken', type: 'address' },
            { name: 'refundReceiver', type: 'address' },
            { name: 'nonce', type: 'uint256' }
          ]
        },
        primaryType: 'SafeTx',
        domain: {
          verifyingContract: safeAddress,
          chainId: this.networks[network].chainId
        },
        message: transaction
      };

      const result = {
      ...transaction,
      safeTxHash,
        txHash,
        threshold: Number(threshold),
        typedData
      };
      console.log('Transaction preparation completed successfully:', JSON.stringify(result, null, 2));
      return result;

    } catch (error) {
      console.error('Error in prepareTransaction:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
      }
      throw error;
    }
  }

  async getPendingTransactions(safeAddress: string, network: string): Promise<SafeTransaction[]> {
    try {
      console.log('Starting getPendingTransactions with params:', { safeAddress, network });

      // Validate address
      if (!ethers.isAddress(safeAddress)) {
        throw new Error(`Invalid Safe address: ${safeAddress}`);
      }

      // Get provider and verify network configuration
      const provider = this.getProvider(network);
      const networkConfig = this.networks[network];
      if (!networkConfig) {
        throw new Error(`Unsupported network: ${network}`);
      }

      // Create SafeTxPool contract instance
      const safeTxPoolContract = new ethers.Contract(
        networkConfig.safeTxPool,
        [
          'function getPendingTxHashes(address safe) view returns (bytes32[])',
          'function getTxDetails(bytes32 txHash) view returns (address safe, address to, uint256 value, bytes data, uint8 operation, address proposer, uint256 nonce)',
          'function getSignatures(bytes32 txHash) view returns (bytes[] memory)'
        ],
        provider
      );

      // Get pending transaction hashes
      console.log('Fetching pending transaction hashes...');
      const pendingTxHashes = await safeTxPoolContract.getPendingTxHashes(safeAddress);
      console.log(`Found ${pendingTxHashes.length} pending transactions`);

      // Get details for each transaction
      const transactions = await Promise.all(
        pendingTxHashes.map(async (txHash: string) => {
          const [safe, to, value, data, operation, proposer, nonce] = await safeTxPoolContract.getTxDetails(txHash);
          const signatures = await safeTxPoolContract.getSignatures(txHash);

    return {
            txHash,
            safe,
            to,
            value: value.toString(),
            data,
            operation,
            proposer,
            nonce: nonce.toString(),
            signatures
          };
        })
      );

      console.log('Successfully retrieved all transaction details');
      return transactions;

    } catch (error) {
      console.error('Error in getPendingTransactions:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
      }
      throw error;
    }
  }

  // Replace the mock implementation with a real one
  async addSignature(
    safeAddress: string,
    safeTxHash: string,
    signature: string,
    network: string
  ): Promise<{ signatures: string[] }> {
    try {
      console.log('Starting addSignature with params:', { safeAddress, safeTxHash, signature, network });

      // Validate addresses and parameters
      if (!ethers.isAddress(safeAddress)) {
        throw new Error(`Invalid Safe address: ${safeAddress}`);
      }
      if (!safeTxHash || !ethers.isHexString(safeTxHash, 32)) {
        throw new Error(`Invalid transaction hash: ${safeTxHash}`);
      }
      if (!signature || !ethers.isHexString(signature)) {
        throw new Error(`Invalid signature: ${signature}`);
      }

      // Get provider and verify network configuration
      const provider = this.getProvider(network);
      const networkConfig = this.networks[network];
      if (!networkConfig) {
        throw new Error(`Unsupported network: ${network}`);
      }

      // Create SafeTxPool contract instance
      const safeTxPoolContract = new ethers.Contract(
        networkConfig.safeTxPool,
        [
          'function signTx(bytes32 txHash, bytes signature) external',
          'function getSignatures(bytes32 txHash) view returns (bytes[] memory)'
        ],
        provider
      );

      // Get the current signatures
      const currentSignatures = await safeTxPoolContract.getSignatures(safeTxHash);
      console.log(`Current signatures count: ${currentSignatures.length}`);

      // Check if the signature already exists
      const signatureExists = currentSignatures.some((sig: string) => sig === signature);
      if (signatureExists) {
        console.log('Signature already exists, skipping addition');
        return { signatures: currentSignatures };
      }

      // In a real implementation, we would use a wallet to sign the transaction
      // For now, we'll just simulate adding the signature to our local storage
      console.log('Adding signature to SafeTxPool (simulated)');
      
      // Return the updated signatures (simulated)
      const updatedSignatures = [...currentSignatures, signature];
      return { signatures: updatedSignatures };
    } catch (error) {
      console.error('Error in addSignature:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
      }
      throw error;
    }
  }

  // Replace the mock implementation with a real one
  async executeTransaction(
    safeAddress: string,
    safeTxHash: string,
    network: string
  ): Promise<{ transactionHash: string }> {
    try {
      console.log('Starting executeTransaction with params:', { safeAddress, safeTxHash, network });

      // Validate addresses and parameters
      if (!ethers.isAddress(safeAddress)) {
        throw new Error(`Invalid Safe address: ${safeAddress}`);
      }
      if (!safeTxHash || !ethers.isHexString(safeTxHash, 32)) {
        throw new Error(`Invalid transaction hash: ${safeTxHash}`);
      }

      // Get provider and verify network configuration
      const provider = this.getProvider(network);
      const networkConfig = this.networks[network];
      if (!networkConfig) {
        throw new Error(`Unsupported network: ${network}`);
      }

      // Create SafeTxPool contract instance
      const safeTxPoolContract = new ethers.Contract(
        networkConfig.safeTxPool,
        [
          'function getTxDetails(bytes32 txHash) view returns (address safe, address to, uint256 value, bytes data, uint8 operation, address proposer, uint256 nonce)',
          'function getSignatures(bytes32 txHash) view returns (bytes[] memory)',
          'function markAsExecuted(bytes32 txHash) external'
        ],
        provider
      );

      // Get transaction details
      const [safe, to, value, data, operation, proposer, nonce] = await safeTxPoolContract.getTxDetails(safeTxHash);
      console.log('Transaction details:', { safe, to, value: value.toString(), operation, nonce: nonce.toString() });

      // Get signatures
      const signatures = await safeTxPoolContract.getSignatures(safeTxHash);
      console.log(`Signatures count: ${signatures.length}`);

      // Create Safe contract instance
      const safeContract = new ethers.Contract(
        safeAddress,
        [
          'function getThreshold() view returns (uint256)',
          'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)'
        ],
        provider
      );

      // Get threshold
      const threshold = await safeContract.getThreshold();
      console.log(`Safe threshold: ${threshold}`);

      // Check if we have enough signatures
      if (signatures.length < threshold) {
        throw new Error(`Not enough signatures: ${signatures.length}/${threshold}`);
      }

      // In a real implementation, we would use a wallet to execute the transaction
      // For now, we'll just simulate execution
      console.log('Executing transaction (simulated)');
      
      // Return a simulated transaction hash
      const transactionHash = `0x${Math.random().toString(16).substring(2)}`;
      return { transactionHash };
    } catch (error) {
      console.error('Error in executeTransaction:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
      }
      throw error;
    }
  }

  async sendSafeTransaction(
    safeAddress: string,
    to: string,
    value: string,
    data: string,
    operation: number,
    network: string
  ): Promise<SafeTransactionDataPartial & { safeTxHash: string; threshold: number }> {
    return this.prepareTransaction(safeAddress, to, value, data, operation, network);
  }
}
