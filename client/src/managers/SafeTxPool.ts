import { ethers } from 'ethers';
import { NetworkConfig } from '../types/network';
import { SAFE_TX_POOL_ABI } from '../config/contracts';
import { SafeTransaction } from '../types/safe';

// Interface for the contract
type SafeTxPoolContract = ethers.Contract & {
  proposeTx: {
    (
      txHash: string,
      safe: string,
      to: string,
      value: string,
      data: string,
      operation: number,
      nonce: string,
      overrides?: ethers.Overrides
    ): Promise<ethers.ContractTransactionResponse>;
    estimateGas(
      txHash: string,
      safe: string,
      to: string,
      value: string,
      data: string,
      operation: number,
      nonce: string,
      overrides?: ethers.Overrides
    ): Promise<bigint>;
  };
  getPendingTxHashes: (safe: string) => Promise<string[]>;
  getTxDetails: (txHash: string) => Promise<[string, string, bigint, string, number, string, bigint]>;
  getSignatures: (txHash: string) => Promise<string[]>;
  signTx: (txHash: string, signature: string) => Promise<ethers.ContractTransactionResponse>;
  markAsExecuted: (txHash: string) => Promise<ethers.ContractTransactionResponse>;
  hasSignedTx: (txHash: string, signer: string) => Promise<boolean>;
  deleteTx: {
    (txHash: string, overrides?: ethers.Overrides): Promise<ethers.ContractTransactionResponse>;
    estimateGas(txHash: string, overrides?: ethers.Overrides): Promise<bigint>;
  };
};

export class SafeTxPool {
  private contract: SafeTxPoolContract;
  private provider: ethers.JsonRpcProvider;

  constructor(address: string, network: NetworkConfig) {
    this.provider = new ethers.JsonRpcProvider(network.provider);
    this.contract = new ethers.Contract(address, SAFE_TX_POOL_ABI, this.provider) as SafeTxPoolContract;
  }

  async proposeTransaction(
    safeTxHash: string,
    safeAddress: string,
    to: string,
    value: string,
    data: string,
    operation: number,
    nonce: string,
    signer: ethers.Signer
  ): Promise<ethers.ContractTransactionResponse> {
    // Connect the contract to the signer
    const connectedContract = this.contract.connect(signer) as SafeTxPoolContract;

    try {
      // Convert safeTxHash to bytes32 - if it's already a hex string, use it directly
      const txHashBytes32 = safeTxHash.startsWith('0x') ? safeTxHash : ethers.hexlify(safeTxHash);
      
      // Handle value conversion properly - if it's already a hex string, use it directly
      let valueToUse = value;
      if (!value.startsWith('0x')) {
        try {
          // Try to parse as ether amount (e.g., "0.01")
          valueToUse = ethers.parseEther(value).toString();
        } catch (e) {
          // If parsing fails, assume it's already a decimal string representation of wei
          valueToUse = value;
        }
      }

      const signerAddress = await signer.getAddress();
      console.log('Proposing transaction with params:', {
        txHashBytes32,
        safeAddress,
        to,
        value: valueToUse,
        data,
        operation,
        nonce,
        signerAddress
      });

      // Check if transaction already exists
      try {
        const txDetails = await this.contract.getTxDetails(txHashBytes32);
        if (txDetails && txDetails[0] !== ethers.ZeroAddress) {
          console.error('Transaction with this hash already exists:', txDetails);
          throw new Error('Transaction with this hash already exists');
        }
      } catch (error: any) {
        // If error is not "TransactionNotFound", rethrow it
        if (!error.message.includes('TransactionNotFound')) {
          throw error;
        }
        // Otherwise, transaction doesn't exist, which is what we want
      }

      // Prepare the transaction data
      const txData = this.contract.interface.encodeFunctionData('proposeTx', [
        txHashBytes32,
        safeAddress,
        to,
        valueToUse,
        data,
        operation,
        nonce
      ]);

      // Estimate gas with a buffer
      const gasEstimate = await this.provider.estimateGas({
        to: this.contract.target,
        data: txData,
        from: signerAddress
      });

      // Add 20% buffer to gas estimate
      const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100);

      console.log('Sending transaction with gas limit:', gasLimit.toString());

      // Send the transaction using the contract's proposeTx method
      const tx = await connectedContract.proposeTx(
        txHashBytes32,
        safeAddress,
        to,
        valueToUse,
        data,
        operation,
        nonce,
        {
          gasLimit
        }
      );

      console.log('Transaction sent:', tx.hash);
      return tx;
    } catch (error) {
      console.error('Error in proposeTransaction:', error);
      throw error;
    }
  }

  async getPendingTransactions(safe: string): Promise<string[]> {
    return await this.contract.getPendingTxHashes(safe);
  }

  async getTransactionDetails(txHash: string): Promise<SafeTransaction> {
    const [safe, to, value, data, operation, proposer, nonce] = await this.contract.getTxDetails(txHash);
    const signatures = await this.contract.getSignatures(txHash);

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
  }

  async signTransaction(txHash: string, signature: string, signer: ethers.Signer): Promise<void> {
    const contractWithSigner = this.contract.connect(signer) as SafeTxPoolContract;
    await contractWithSigner.signTx(txHash, signature);
  }

  async hasSignedTransaction(txHash: string, signer: string): Promise<boolean> {
    return await this.contract.hasSignedTx(txHash, signer);
  }

  async markAsExecuted(txHash: string, signer: ethers.Signer): Promise<void> {
    const contractWithSigner = this.contract.connect(signer) as SafeTxPoolContract;
    await contractWithSigner.markAsExecuted(txHash);
  }
} 