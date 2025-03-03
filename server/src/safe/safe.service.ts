import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { SafeInfo, SafeTransaction, SafeTransactionDataPartial } from './types';

@Injectable()
export class SafeService {
  private readonly networks: { [key: string]: { chainId: number; provider: string } } = {
    mainnet: {
      chainId: 1,
      provider: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    },
    arbitrum: {
      chainId: 42161,
      provider: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    },
    sepolia: {
      chainId: 11155111,
      provider: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    },
  };

  constructor(private readonly configService: ConfigService) {}

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
  ): Promise<SafeTransactionDataPartial & { safeTxHash: string; threshold: number }> {
    const provider = this.getProvider(network);
    const safeContract = new ethers.Contract(
      safeAddress,
      ['function nonce() view returns (uint256)', 'function getThreshold() view returns (uint256)'],
      provider
    );

    const [nonce, threshold] = await Promise.all([
      safeContract.nonce(),
      safeContract.getThreshold()
    ]);

    const transaction = {
      to,
      value,
      data,
      operation,
      nonce: nonce.toString(),
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
    };

    // Calculate safeTxHash
    const abiCoder = new ethers.AbiCoder();
    const encodedData = abiCoder.encode(
      ['address', 'uint256', 'bytes', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
      [transaction.to, transaction.value, transaction.data, transaction.operation, transaction.safeTxGas, transaction.baseGas, transaction.gasPrice, transaction.gasToken, transaction.refundReceiver, transaction.nonce]
    );
    const safeTxHash = ethers.keccak256(encodedData);

    return {
      ...transaction,
      safeTxHash,
      threshold: Number(threshold)
    };
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
