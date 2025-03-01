import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

@Injectable()
export class SafeService {
  private provider: ethers.JsonRpcProvider;
  private safeContract: ethers.Contract;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('RPC_URL');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async getSafeInfo(safeAddress: string) {
    const safeAbi = [
      'function getOwners() external view returns (address[] memory)',
      'function getThreshold() external view returns (uint256)',
    ];

    this.safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);

    try {
      console.log(`Fetching Safe info for ${safeAddress}`);
      const owners = await this.safeContract.getOwners();
      const threshold = await this.safeContract.getThreshold();
      console.log(`Safe RPC response: owners=${owners}, threshold=${threshold}`);
      return { address: safeAddress, owners, threshold: Number(threshold) };
    } catch (err) {
      console.error(`Safe RPC error: ${err.message}`);
      throw err;
    }
  }

  async sendSafeTransaction(
    safeAddress: string,
    to: string,
    value: string,
    data: string,
    operation: number,
  ): Promise<any> {
    // Define the Safe contract ABI for execTransaction
    const safeAbi = [
      'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) external returns (bool success)',
    ];

    // Initialize the Safe contract
    this.safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);

    try {
      // Placeholder for future signer integration (e.g., via WalletConnect)
      // For now, we'll throw an error since we don't have a signer
      throw new Error('sendSafeTransaction not fully implemented: Signer integration required');

      // Example of how this might look with a signer (commented out for now):
      /*
      const signer = ...; // Retrieve signer (e.g., from WalletConnect)
      const safeContractWithSigner = this.safeContract.connect(signer);

      // Prepare transaction parameters (minimal for now, can be expanded)
      const safeTxGas = 0;
      const baseGas = 0;
      const gasPrice = 0;
      const gasToken = ethers.constants.AddressZero;
      const refundReceiver = ethers.constants.AddressZero;
      const signatures = "0x"; // Placeholder: Needs proper signature from signer

      // Execute the transaction
      const tx = await safeContractWithSigner.execTransaction(
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        signatures,
      );

      const receipt = await tx.wait();
      return { success: true, transactionHash: receipt.transactionHash };
      */
    } catch (err) {
      console.error(`Failed to send Safe transaction: ${err.message}`);
      throw new Error(`Failed to send Safe transaction: ${err.message}`);
    }
  }
}
