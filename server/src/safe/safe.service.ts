import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { SafeInfo, SafeTransaction, SafeTransactionDataPartial } from './types';

@Injectable()
export class SafeService {
  private networks: { [key: string]: { chainId: number; provider: string } };

  constructor(private readonly configService: ConfigService) {
    const alchemyApiKey = this.configService.get<string>('ALCHEMY_API_KEY');
    if (!alchemyApiKey) {
      throw new Error('ALCHEMY_API_KEY environment variable is not set');
    }

    this.networks = {
      mainnet: {
        chainId: 1,
        provider: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      },
      arbitrum: {
        chainId: 42161,
        provider: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      },
      sepolia: {
        chainId: 11155111,
        provider: `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`,
      },
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

  // Mock implementation for pending transactions
  async getPendingTransactions(safeAddress: string): Promise<{
    results: any[];
    notice: string;
  }> {
    // Return empty results with a notice about API limitation
    return {
      results: [],
      notice: 'Transaction history is currently unavailable. This feature will be enabled when the Safe API service is live.'
    };
  }

  // Mock implementation for submitting signatures
  async submitSignature(
    safeAddress: string,
    safeTxHash: string,
    signature: string
  ): Promise<void> {
    throw new Error('Signature submission is currently unavailable. This feature will be enabled when the Safe API service is live.');
  }

  // Mock implementation for executing transactions
  async executeTransaction(
    safeAddress: string,
    safeTxHash: string
  ): Promise<void> {
    throw new Error('Transaction execution is currently unavailable. This feature will be enabled when the Safe API service is live.');
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
